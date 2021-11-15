/* eslint-disable no-unused-vars */
/* eslint-disable consistent-return */
import { completeContactLoad, failedContactLoad } from "../../../workers/jobs";
import { r } from "../../../server/models";
import { getConfig, hasConfig } from "../../../server/api/lib/config";
import {
  GVIRS_INTEGRATION_ENDPOINT,
  GVIRS_MINQUERY_SIZE,
  GVIRS_CACHE_SECONDS,
  GVIRS_ENVIRONMENTAL_VARIABLES_MANDATORY,
  GVIRS_ENVIRONMENTAL_VARIABLES_OPTIONAL,
  GVIRS_CONTACT_LOADER
} from "./const";
import { log } from "../../../lib/log";
import {
  searchSegments,
  decomposeGVIRSConnections,
  getGVIRSCustomFields,
  getSegmentContacts
} from "./util";

export const name = GVIRS_CONTACT_LOADER;

export function displayName() {
  return "gVIRS";
}

export function serverAdministratorInstructions() {
  return {
    environmentVariables: [
      ...GVIRS_ENVIRONMENTAL_VARIABLES_MANDATORY,
      ...GVIRS_ENVIRONMENTAL_VARIABLES_OPTIONAL
    ],
    description: "Allows you to pull contacts directly from gVIRS",
    setupInstructions:
      "Configure the mandatory environment variables to connect to a gVIRS instance"
  };
}

export async function available(organization, user) {
  // / return an object with two keys: result: true/false
  // / these keys indicate if the ingest-contact-loader is usable
  // / Sometimes credentials need to be setup, etc.
  // / A second key expiresSeconds: should be how often this needs to be checked
  // / If this is instantaneous, you can have it be 0 (i.e. always), but if it takes time
  // / to e.g. verify credentials or test server availability,
  // / then it's better to allow the result to be cached
  const result =
    GVIRS_ENVIRONMENTAL_VARIABLES_MANDATORY.every(varName =>
      hasConfig(varName)
    ) &&
    organization.name in
      decomposeGVIRSConnections(getConfig("GVIRS_CONNECTIONS"));
  return {
    result,
    expiresSeconds: GVIRS_CACHE_SECONDS
  };
}

export function addServerEndpoints(expressApp) {
  // / If you need to create API endpoints for server-to-server communication
  // / this is where you would run e.g. app.post(....)
  // / Be mindful of security and make sure there's
  // / This is NOT where or how the client send or receive contact data
  expressApp.get(GVIRS_INTEGRATION_ENDPOINT, (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({});
    }

    const { query, clientchoicedata } = req.query;
    if (query.length < GVIRS_MINQUERY_SIZE) {
      return res.json({ segments: [] }); // ignore dumb queries
    }
    // If there is no organization, nothing will be shown.
    const decodeClientChoiceData = JSON.parse(clientchoicedata);
    if (!("name" in decodeClientChoiceData)) {
      return res.json({ segments: [] });
    }
    searchSegments(query || "", decodeClientChoiceData.name)
      .then(segments => res.json({ segments }))
      .catch(error => {
        log.error(error);
        res.json({ segments: [], error });
      });
  });
}

export function clientChoiceDataCacheKey(campaign, user) {
  // / returns a string to cache getClientChoiceData -- include items that relate to cacheability
  return `${campaign.id}`;
}

export async function getClientChoiceData(organization, campaign, user) {
  // / data to be sent to the admin client to present options to the component or similar
  // / The react-component will be sent this data as a property
  // / return a json object which will be cached for expiresSeconds long
  // / `data` should be a single string -- it can be JSON which you can parse in the client component
  const connectionData = decomposeGVIRSConnections(
    getConfig("GVIRS_CONNECTIONS")
  );
  let passClientChoiceData = "{}";
  if (organization.name in connectionData) {
    passClientChoiceData = JSON.stringify({ name: organization.name });
  }
  return {
    data: passClientChoiceData,
    expiresSeconds: GVIRS_CACHE_SECONDS
  };
}

export async function processContactLoad(job, maxContacts, organization) {
  // / Trigger processing -- this will likely be the most important part
  // / you should load contacts into the contact table with the job.campaign_id
  // / Since this might just *begin* the processing and other work might
  // / need to be completed asynchronously after this is completed (e.g. to distribute loads)
  // / After true contact-load completion, this (or another function)
  // / MUST call src/workers/jobs.js::completeContactLoad(job)
  // /   The async function completeContactLoad(job) will
  // /      * delete contacts that are in the opt_out table,
  // /      * delete duplicate cells,
  // /      * clear/update caching, etc.
  // / The organization parameter is an object containing the name and other
  // /   details about the organization on whose behalf this contact load
  // /   was initiated. It is included here so it can be passed as the
  // /   second parameter of getConfig in order to retrieve organization-
  // /   specific configuration values.
  // / Basic responsibilities:
  // / 1. Delete previous campaign contacts on a previous choice/upload
  // / 2. Set campaign_contact.campaign_id = job.campaign_id on all uploaded contacts
  // / 3. Set campaign_contact.message_status = "needsMessage" on all uploaded contacts
  // / 4. Ensure that campaign_contact.cell is in the standard phone format "+15551234567"
  // /    -- do NOT trust your backend to ensure this
  // / 5. If your source doesn't have timezone offset info already, then you need to
  // /    fill the campaign_contact.timezone_offset with getTimezoneByZip(contact.zip) (from "../../workers/jobs")
  // / Things to consider in your implementation:
  // / * Batching
  // / * Error handling
  // / * "Request of Doom" scenarios -- queries or jobs too big to complete

  const campaignId = job.campaign_id;

  const customFields = getGVIRSCustomFields(getConfig("GVIRS_CUSTOM_DATA"));
  const customFieldNames = Object.keys(customFields);

  await r
    .knex("campaign_contact")
    .where("campaign_id", campaignId)
    .delete();

  const contactData = JSON.parse(job.payload);

  let finalCount = 0;
  const contactsForAdding = {};
  for (const segment of contactData.segmentIds) {
    const newContacts = await getSegmentContacts(
      segment.id,
      campaignId,
      organization.name
    );

    // Spoke will not store multiple records with the same phone number.
    // It goes for a "last record wins" strategy, so we do the same. Note
    // that this also helps us prevent double-counting of contacts when
    // they appear in more than one group.

    for (const contactRecord of newContacts) {
      contactsForAdding[contactRecord.cell] = contactRecord;
    }
    // });
  }

  const newContactRecords = Object.values(contactsForAdding);
  finalCount = newContactRecords.length;

  if (finalCount) {
    await r.knex.batchInsert("campaign_contact", newContactRecords, finalCount);
  }

  await completeContactLoad(
    job,
    null,
    // see failedContactLoad above for descriptions
    String(contactData.segmentId),
    JSON.stringify({ finalCount })
  );
}
