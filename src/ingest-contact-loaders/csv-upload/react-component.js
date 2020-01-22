import type from "prop-types";
import React from "react";
import RaisedButton from "material-ui/RaisedButton";
import GSForm from "../../components/forms/GSForm";
import Form from "react-formal";
import Subheader from "material-ui/Subheader";
import Divider from "material-ui/Divider";
import { ListItem, List } from "material-ui/List";
import { parseCSV, gzip } from "../../lib";
import CampaignFormSectionHeading from "../../components/CampaignFormSectionHeading";
import { StyleSheet, css } from "aphrodite";
import theme from "../../styles/theme";
import yup from "yup";

const innerStyles = {
  button: {
    margin: "24px 5px 24px 0",
    fontSize: "10px"
  },
  nestedItem: {
    fontSize: "12px"
  }
};

const styles = StyleSheet.create({
  csvHeader: {
    fontFamily: "Courier",
    backgroundColor: theme.colors.lightGray,
    padding: 3
  },
  exampleImageInput: {
    cursor: "pointer",
    position: "absolute",
    top: 0,
    bottom: 0,
    right: 0,
    left: 0,
    width: "100%",
    opacity: 0
  }
});

export class CampaignContactsForm extends React.Component {
  state = {
    uploading: false,
    validationStats: null,
    contactUploadError: null
  };

  handleUpload = event => {
    event.preventDefault();
    const file = event.target.files[0];
    this.setState({ uploading: true }, () => {
      parseCSV(
        file,
        ({ contacts, customFields, validationStats, error }) => {
          console.log('FINAL', contacts, customFields, validationStats, error);
          if (error) {
            this.handleUploadError(error);
          } else if (contacts.length === 0) {
            this.handleUploadError("Upload at least one contact");
          } else if (contacts.length > 0) {
            this.handleUploadSuccess(validationStats,
                                     this.organizationCustomFields(contacts, customFields),
                                     customFields);
          }
        }
      );
    });
  };

  handleUploadError(error) {
    this.setState({
      validationStats: null,
      uploading: false,
      contactUploadError: error,
      contacts: null
    });
  }

  organizationCustomFields(contacts, customFieldsList) {
    return contacts.map(contact => {
      const customFields = {};
      const contactInput = {
        cell: contact.cell,
        first_name: contact.firstName,
        last_name: contact.lastName,
        zip: contact.zip || "",
        external_id: contact.external_id || ""
      };
      customFieldsList.forEach(key => {
        if (contact.hasOwnProperty(key)) {
          customFields[key] = contact[key];
        }
      });
      contactInput.custom_fields = JSON.stringify(customFields);
      return contactInput;
    });
  }

  handleUploadSuccess(validationStats, contacts, customFields) {
    this.setState({
      validationStats,
      customFields,
      uploading: false,
      contactUploadError: null,
      contactsCount: contacts.length
    });
    const contactCollection = {
      contactsCount: contacts.length,
      customFields,
      contacts
    };
    const self = this;
    // this.props.onChange(JSON.stringify(contactCollection));
    gzip(JSON.stringify(contactCollection)).then(gzippedData => {
      self.props.onChange(gzippedData.toString("base64"));
    })
  }

  renderContactStats() {
    const { customFields, contactsCount } = this.state;

    if (!contactsCount) {
      return "";
    }
    return (
      <List>
        <Subheader>Uploaded</Subheader>
        <ListItem
          primaryText={`${contactsCount} contacts`}
          leftIcon={this.props.icons.check}
        />
        <ListItem
          primaryText={`${customFields.length} custom fields`}
          leftIcon={this.props.icons.check}
          nestedItems={customFields.map((field, index) => (
            <ListItem
              key={index}
              innerDivStyle={innerStyles.nestedItem}
              primaryText={field}
            />
          ))}
        />
      </List>
    );
  }

  renderValidationStats() {
    if (!this.state.validationStats) {
      return "";
    }

    const {
      dupeCount,
      missingCellCount,
      invalidCellCount
    } = this.state.validationStats;

    let stats = [
      [dupeCount, "duplicates"],
      [missingCellCount, "rows with missing numbers"],
      [invalidCellCount, "rows with invalid numbers"]
    ];
    stats = stats
      .filter(([count]) => count > 0)
      .map(([count, text]) => `${count} ${text} removed`);
    return (
      <List>
        <Divider />
        {stats.map((stat, index) => (
          <ListItem
            key={index}
            leftIcon={this.props.icons.warning}
            innerDivStyle={innerStyles.nestedItem}
            primaryText={stat}
          />
        ))}
      </List>
    );
  }

  renderUploadButton() {
    const { uploading } = this.state;
    return (
      <div>
        <RaisedButton
          style={innerStyles.button}
          label={uploading ? "Uploading..." : "Upload contacts"}
          labelPosition="before"
          disabled={uploading}
          onClick={() => this.uploadButton.click()}
        />
        <input
          id="contact-upload"
          ref={input => input && (this.uploadButton = input)}
          type="file"
          className={css(styles.exampleImageInput)}
          onChange={this.handleUpload}
          style={{ display: "none" }}
        />
      </div>
    );
  }

  renderForm() {
    const { contactUploadError } = this.state;
    return (
      <div>
        {!this.props.jobResultMessage ? (
          ""
        ) : (
          <div>
            <CampaignFormSectionHeading title="Job Outcome" />
            <div>{this.props.jobResultMessage}</div>
          </div>
        )}
        <GSForm
          schema={yup.object({
          })}
          onSubmit={formValues => {
            this.props.onSubmit();
          }}
        >
          {this.renderUploadButton()}
          {this.renderContactStats()}
          {this.renderValidationStats()}
          {contactUploadError ? (
            <List>
              <ListItem primaryText={contactUploadError} leftIcon={this.props.icons.error} />
            </List>
          ) : (
            ""
          )}
          <Form.Button
            type="submit"
            disabled={this.props.saveDisabled}
            label={this.props.saveLabel}
          />
        </GSForm>
      </div>
    );
  }

  render() {
    let subtitle = (
      <span>
        Your upload file should be in CSV format with column headings in the
        first row. You must include{" "}
        <span className={css(styles.csvHeader)}>firstName</span>,
        <span className={css(styles.csvHeader)}>lastName</span>, and
        <span className={css(styles.csvHeader)}>cell</span> columns. If you
        include a <span className={css(styles.csvHeader)}>zip</span> column,
        we'll use the zip to guess the contact's timezone for enforcing texting
        hours. An optional column to map the contact to a CRM is{" "}
        <span className={css(styles.csvHeader)}>external_id</span>
        Any additional columns in your file will be available as custom fields
        to use in your texting scripts.
      </span>
    );

    return (
      <div>
        {subtitle}
        {this.renderForm()}
      </div>
    );
  }
}

CampaignContactsForm.propTypes = {
  onChange: type.func,
  onSubmit: type.func,
  campaignIsStarted: type.bool,

  icons: type.object,

  saveDisabled: type.bool,
  saveLabel: type.string,

  clientChoiceData: type.string,
  jobResultMessage: type.string
};
