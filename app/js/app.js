let app_id, account_id;
let cachedFile = null;
let cachedBase64 = null;

ZOHO.embeddedApp.on("PageLoad", async (entity) => {
  try {
    const entity_id = entity.EntityId;
    const appResponse = await ZOHO.CRM.API.getRecord({
      Entity: "Applications1",
      approved: "both",
      RecordID: entity_id,
    });
    const applicationData = appResponse.data[0];
    app_id = applicationData.id;
    
    // Check for Account ID and handle if missing
    if (!applicationData.Account_Name || !applicationData.Account_Name.id) {
        console.error("Application record is missing a linked Account ID. Cannot proceed with data fetch.");
        // Prevent setting account_id if null/undefined
        // The submission logic will catch this later, but useful to log now.
    } else {
        account_id = applicationData.Account_Name.id;
    }

    const accountResponse = await ZOHO.CRM.API.getRecord({
      Entity: "Accounts",
      approved: "both",
      RecordID: account_id,
    });

    const accountData = accountResponse.data[0];
    legalNameTaxablePerson = accountData.Legal_Name_of_Taxable_Person;
    vatTrn = accountData.TRN_Number;

    console.log("LEGAL NAME OF TAXABLE PERSON: ", legalNameTaxablePerson);
    console.log("VAT TRN: ", vatTrn);

    document.getElementById("name-of-taxable-person").value = legalNameTaxablePerson || "";
    document.getElementById("tax-registration-number").value = vatTrn || "";

  } catch (err) {
    console.error(err);
  }
});

function clearErrors() {
  document.querySelectorAll(".error-message").forEach((span) => {
    span.textContent = "";
  });
}

function showError(fieldId, message) {
  const errorSpan = document.getElementById(`error-${fieldId}`);
  if (errorSpan) errorSpan.textContent = message;
}

function showUploadBuffer() {
  const buffer = document.getElementById("upload-buffer");
  const bar = document.getElementById("upload-progress");
  if (buffer) buffer.classList.remove("hidden");
  if (bar) {
    bar.classList.remove("animate");
    void bar.offsetWidth;
    bar.classList.add("animate");
  }
}

function hideUploadBuffer() {
  const buffer = document.getElementById("upload-buffer");
  if (buffer) buffer.classList.add("hidden");
}

async function cacheFileOnChange(event) {
  clearErrors();

  const fileInput = event.target;
  const file = fileInput?.files[0];
  if (!file) return;

  if (file.size > 20 * 1024 * 1024) {
    showError("fta-notive-of-submission", "File size must not exceed 20MB.");
    return;
  }

  showUploadBuffer();

  try {
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });

    cachedFile = file;
    cachedBase64 = base64;

    await new Promise((res) => setTimeout(res, 3000));
    hideUploadBuffer();
  } catch (err) {
    console.error("Error caching file:", err);
    hideUploadBuffer();
    showError("fta-notive-of-submission", "Failed to read file.");
  }
}

async function uploadFileToCRM() {
  if (!cachedFile || !cachedBase64) {
    throw new Error("No cached file");
  }

  return await ZOHO.CRM.API.attachFile({
    Entity: "Applications1",
    RecordID: app_id,
    File: {
      Name: cachedFile.name,
      Content: cachedBase64,
    },
  });
}

function complete_trigger() {
  ZOHO.CRM.BLUEPRINT.proceed();
}

async function update_record(event = null) {
    if (event) event.preventDefault();

    clearErrors();

    let hasError = false;
    const submitBtn = document.getElementById("submit_button_id");
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Submitting...";
    }

    const referenceNo = document.getElementById("reference-number")?.value;
    const taxablePerson = document.getElementById("name-of-taxable-person")?.value;
    const taxRegNo = document.getElementById("tax-registration-number")?.value;
    const appDate = document.getElementById("application-date")?.value;
    const safe_account_id = account_id ? account_id.trim() : "";

    if (!referenceNo) {
        showError("reference-number", "Reference Number is required.");
        hasError = true;
    }  
    if (!taxablePerson) {
        showError("name-of-taxable-person", "Legal Name of Taxable Person is required.");
        hasError = true;
    }
    if (!taxRegNo) {
        showError("tax-registration-number", "Tax Registration Number is required.");
        hasError = true;
    }
    if(!appDate) {
        showError("application-date", "Application Date is required.");
        hasError = true;
    }
    if (!cachedFile || !cachedBase64) {
        showError("fta-notive-of-submission", "Please upload the FTA Notice of Submission or FTA acknowledgement.");
        hasError = true;
    }

    if (!safe_account_id) {
      showError("submit_button_id", "Error: Associated Account ID is missing. Cannot proceed.");
      hasError = true;
      console.error("FATAL ERROR: Account ID is missing.");
    }

    if (hasError) {
        if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Submit";
        }
        return;
    }

    try {

        await ZOHO.CRM.API.updateRecord({
            Entity: "Applications1",
            APIData: {
                id: app_id,
                Reference_Number: referenceNo,
                Legal_Name_of_Taxable_Person: taxablePerson,
                Tax_Registration_Number_TRN: taxRegNo,
                Application_Date: appDate,
            },
        });

        // Pass ALL required data to the Deluge function via JSON string
        const func_name = "ta_vatdr_submit_to_auth_update_account";
        const req_data = {
            "arguments": JSON.stringify({
                "account_id": safe_account_id,
                "legal_name_of_taxable_person": taxablePerson,
                "trn_number": taxRegNo
            })
        };

        const accountResponse = await ZOHO.CRM.FUNCTIONS.execute(func_name, req_data);
        console.log("Account Update Function Response:", accountResponse);

        await uploadFileToCRM();
        await ZOHO.CRM.BLUEPRINT.proceed();
        await ZOHO.CRM.UI.Popup.closeReload();
    } catch (error) {
    console.error("Error on final submit:", error);
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit";
    }
  }
}

document.getElementById("fta-notive-of-submission").addEventListener("change", cacheFileOnChange);
document.getElementById("record-form").addEventListener("submit", update_record);

async function closeWidget() {
  await ZOHO.CRM.UI.Popup.closeReload().then(console.log);
}

ZOHO.embeddedApp.init();