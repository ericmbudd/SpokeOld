/* eslint-disable no-unused-expressions, consistent-return */
import { r } from "../../src/server/models/";
import {
  runGql,
  setupTest,
  cleanupTest,
  getGql,
  createUser,
  createInvite,
  createOrganization,
  createCampaign,
  createContacts,
  createTexter,
  assignTexter,
  createScript,
  startCampaign,
  getCampaignContact
} from "../test_helpers";
import waitForExpect from "wait-for-expect";

let testAdminUser;
let testInvite;
let testOrganization;
let testCampaign;
let testTexterUser;
let testTexterUser2;
let testContacts;
let testContact;
let assignmentId;

beforeEach(async () => {
  // Set up an entire working campaign
  await setupTest();
  testAdminUser = await createUser();
  testInvite = await createInvite();
  testOrganization = await createOrganization(testAdminUser, testInvite);
  testCampaign = await createCampaign(testAdminUser, testOrganization);
  testContacts = await createContacts(testCampaign, 100);
  testContact = testContacts[0];
  testTexterUser = await createTexter(testOrganization);
  testTexterUser2 = await createTexter(testOrganization);

  await assignTexter(testAdminUser, testTexterUser, testCampaign);

  const dbCampaignContact = await getCampaignContact(testContact.id);
  assignmentId = dbCampaignContact.assignment_id;
  await createScript(testAdminUser, testCampaign);
  await startCampaign(testAdminUser, testCampaign);
}, global.DATABASE_SETUP_TEARDOWN_TIMEOUT);

afterEach(async () => {
  await cleanupTest();
  if (r.redis) r.redis.flushdb();
}, global.DATABASE_SETUP_TEARDOWN_TIMEOUT);

it("should send an inital message to test contacts", async () => {
  const {
    query: [getContacts, getContactsVars],
    mutations
  } = getGql("../src/containers/TexterTodo", {
    messageStatus: "needsMessage",
    params: { assignmentId }
  });

  const contactsResult = await runGql(
    getContacts,
    getContactsVars,
    testTexterUser
  );

  const [getAssignmentContacts, assignVars] = mutations.getAssignmentContacts(
    contactsResult.data.assignment.contacts.map(e => e.id),
    false
  );

  const ret2 = await runGql(getAssignmentContacts, assignVars, testTexterUser);
  const contact = ret2.data.getAssignmentContacts[0];

  const message = {
    contactNumber: contact.cell,
    userId: testTexterUser.id,
    text: "test text",
    assignmentId
  };

  const [messageMutation, messageVars] = mutations.sendMessage(
    message,
    contact.id
  );

  const messageResult = await runGql(
    messageMutation,
    messageVars,
    testTexterUser
  );
  const campaignContact = messageResult.data.sendMessage;

  // These things are expected to be returned from the sendMessage mutation
  expect(campaignContact.messageStatus).toBe("messaged");
  expect(campaignContact.messages.length).toBe(1);
  expect(campaignContact.messages[0].text).toBe(message.text);

  const expectedDbMessage = {
    // user_id: testTexterUser.id, //FUTURE
    contact_number: testContact.cell,
    text: message.text,
    assignment_id: assignmentId
    // campaign_contact_id: testContact.id //FUTURE
  };

  // wait for fakeservice to mark the message as sent
  await waitForExpect(async () => {
    const dbMessage = await r.knex("message");
    expect(dbMessage.length).toEqual(1);
    expect(dbMessage[0]).toEqual(
      expect.objectContaining({
        send_status: "SENT",
        ...expectedDbMessage
      })
    );
    const dbCampaignContact = await getCampaignContact(testContact.id);
    expect(dbCampaignContact.message_status).toBe("messaged");
  });

  // Refetch the contacts via gql to check the caching
  const ret3 = await runGql(getAssignmentContacts, assignVars, testTexterUser);
  expect(ret3.data.getAssignmentContacts[0].messageStatus).toEqual("messaged");
});

it("should be able to receive a response and reply (using fakeService)", async () => {
  const {
    query: [getContacts, getContactsVars],
    mutations
  } = getGql("../src/containers/TexterTodo", {
    messageStatus: "needsMessage",
    params: { assignmentId }
  });

  const contactsResult = await runGql(
    getContacts,
    getContactsVars,
    testTexterUser
  );

  const [getAssignmentContacts, assignVars] = mutations.getAssignmentContacts(
    contactsResult.data.assignment.contacts.map(e => e.id),
    false
  );

  const ret2 = await runGql(getAssignmentContacts, assignVars, testTexterUser);
  const contact = ret2.data.getAssignmentContacts[0];

  const message = {
    contactNumber: contact.cell,
    userId: testTexterUser.id,
    text: "test text autorespond",
    assignmentId
  };

  const [messageMutation, messageVars] = mutations.sendMessage(
    message,
    contact.id
  );

  await runGql(messageMutation, messageVars, testTexterUser);

  // wait for fakeservice to autorespond
  await waitForExpect(async () => {
    const dbMessage = await r.knex("message");
    expect(dbMessage.length).toEqual(2);
    expect(dbMessage[1]).toEqual(
      expect.objectContaining({
        send_status: "DELIVERED",
        text: `responding to ${message.text}`,
        // user_id: testTexterUser.id, //FUTURE
        contact_number: testContact.cell,
        assignment_id: assignmentId
        // campaign_contact_id: testContact.id //FUTURE
      })
    );
  });

  await waitForExpect(async () => {
    const dbCampaignContact = await getCampaignContact(testContact.id);
    expect(dbCampaignContact.message_status).toBe("needsResponse");
  });

  // Refetch the contacts via gql to check the caching
  const ret3 = await runGql(getAssignmentContacts, assignVars, testTexterUser);
  expect(ret3.data.getAssignmentContacts[0].messageStatus).toEqual(
    "needsResponse"
  );

  // Then we reply
  const message2 = {
    contactNumber: contact.cell,
    userId: testTexterUser.id,
    text: "reply",
    assignmentId
  };

  const [replyMutation, replyVars] = mutations.sendMessage(
    message2,
    contact.id
  );

  await runGql(replyMutation, replyVars, testTexterUser);

  // wait for fakeservice to mark the message as sent
  await waitForExpect(async () => {
    const dbMessage = await r.knex("message");
    expect(dbMessage.length).toEqual(3);
    expect(dbMessage[2]).toEqual(
      expect.objectContaining({
        send_status: "SENT"
      })
    );
    const dbCampaignContact = await getCampaignContact(testContact.id);
    expect(dbCampaignContact.message_status).toBe("convo");
  });

  // Refetch the contacts via gql to check the caching
  const ret4 = await runGql(getAssignmentContacts, assignVars, testTexterUser);
  expect(ret4.data.getAssignmentContacts[0].messageStatus).toEqual("convo");
});

it("should return contacts after they are reassigned", async () => {
  // set up graphQL call for reassignCampaignContacts
  const { mutations: adminIncomingMessageListMutations } = getGql(
    "../src/containers/AdminIncomingMessageList",
    {
      params: {
        organizationId: testOrganization.id
      }
    },
    "organization"
  );

  const [
    reassignCampaignContacts,
    reassignCampaignContactsVars
  ] = adminIncomingMessageListMutations.reassignCampaignContacts(
    testOrganization.data.createOrganization.id,
    testContacts.map(c => {
      return {
        campaignId: testCampaign.id,
        campaignContactId: c.id,
        messageIds: []
      };
    }),
    testTexterUser2.id
  );

  // set up graphQL call for getAssignmentContacts
  const { mutations: mutationsBefore } = getGql(
    "../src/containers/TexterTodo",
    {
      messageStatus: "needsMessage",
      params: {
        assignmentId
      }
    }
  );

  const [
    getAssignmentContactsBefore,
    assignVarsBefore
  ] = mutationsBefore.getAssignmentContacts(testContacts.map(e => e.id), false);

  // call getAssignmentContacts to get CampaignContacts into the DataLoader cache.
  await runGql(getAssignmentContactsBefore, assignVarsBefore, testTexterUser);

  // make the reassign call
  const reassignReturn = await runGql(
    reassignCampaignContacts,
    reassignCampaignContactsVars,
    testAdminUser
  );

  const newAssignmentId =
    reassignReturn.data.reassignCampaignContacts[0].assignmentId;

  // set up getAssignmentContacts to get the contacts so we can examine them
  const { mutations: mutationsAfter } = getGql("../src/containers/TexterTodo", {
    messageStatus: "needsMessage",
    params: {
      assignmentId: newAssignmentId
    }
  });

  const [
    getAssignmentContactsAfter,
    assignVarsAfter
  ] = mutationsAfter.getAssignmentContacts(testContacts.map(e => e.id), false);

  // make getAssignmentContacts call
  const getAssignmentContactsResult = await runGql(
    getAssignmentContactsAfter,
    assignVarsAfter,
    testTexterUser2
  );

  // test our expectations
  expect(getAssignmentContactsResult.data.getAssignmentContacts.length).toBe(
    100
  );
  expect(
    getAssignmentContactsResult.data.getAssignmentContacts.map(c => c.id)
  ).toEqual(testContacts.map(c => c.id.toString()));
});

it("should return contacts with correct opt_out after they are opted out", async () => {
  // set up graphQL call for createOptOut
  const { mutations: assignmentTexterContactMutations } = getGql(
    "../src/containers/AssignmentTexterContact"
  );

  const [
    createOptOut,
    createOptOutVars
  ] = assignmentTexterContactMutations.createOptOut(
    {
      cell: testContacts[0].cell,
      assignmentId
    },
    testContacts[0].id
  );

  // set up graphQL call for getAssignmentContacts
  const { mutations } = getGql("../src/containers/TexterTodo", {
    messageStatus: "needsMessage",
    params: {
      assignmentId
    }
  });

  const [getAssignmentContacts, assignVars] = mutations.getAssignmentContacts(
    testContacts.map(e => e.id),
    false
  );

  // getAssignmentContacts before creating the opt out
  const getAssignmentContactsBeforeResult = await runGql(
    getAssignmentContacts,
    assignVars,
    testTexterUser
  );
  expect(
    getAssignmentContactsBeforeResult.data.getAssignmentContacts[0].optOut
  ).toBeFalsy();

  // create the optOut
  await runGql(createOptOut, createOptOutVars, testTexterUser);

  // getAssignmentContacts after creating the opt out
  const getAssignmentContactsAfterResult = await runGql(
    getAssignmentContacts,
    assignVars,
    testTexterUser
  );

  expect(
    getAssignmentContactsAfterResult.data.getAssignmentContacts[0].optOut
  ).toEqual({ id: "optout" });
});
