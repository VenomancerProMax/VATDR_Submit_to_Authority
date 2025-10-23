let app_id, account_id;
let cachedFile = null;
let cachedBase64 = null;
let isInitialized = false; // Flag to prevent re-initialization

// --- Core Functions for UI/Error Management ---

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

async function closeWidget() {
    // Retain closeWidget for explicit closure, but handle errors silently
    await ZOHO.CRM.UI.Popup.closeReload().catch(console.error);
}

// --- Data Fetching and Auto-Population Logic ---

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
        } else {
            account_id = applicationData.Account_Name.id;
        }

        // Only attempt to fetch Account data if account_id is available
        if (account_id) {
            const accountResponse = await ZOHO.CRM.API.getRecord({
                Entity: "Accounts",
                approved: "both",
                RecordID: account_id,
            });

            const accountData = accountResponse.data[0];
            const legalNameTaxablePerson = accountData.Legal_Name_of_Taxable_Person;
            const vatTrn = accountData.TRN_Number;

            console.log("LEGAL NAME OF TAXABLE PERSON: ", legalNameTaxablePerson);
            console.log("VAT TRN: ", vatTrn);

            document.getElementById("name-of-taxable-person").value = legalNameTaxablePerson || "";
            document.getElementById("tax-registration-number").value = vatTrn || "";
        }

    } catch (err) {
        console.error("Error during PageLoad data fetch:", err);
    }
});

// --- File Handling Functions (FIXED) ---

async function cacheFileOnChange(event) {
    clearErrors();

    const fileInput = event.target;
    const file = fileInput?.files[0];
    
    if (!file) {
        cachedFile = null;
        cachedBase64 = null;
        return;
    }

    const maxSize = 10 * 1024 * 1024; // 10 MB
    if (file.size > maxSize) {
        showError("fta-notive-of-submission", "File size must not exceed 10MB.");
        fileInput.value = ""; // Clear file input
        return;
    }

    showUploadBuffer();

    try {
        // *** FIX: Use readAsDataURL and extract Base64 content for ZOHO API ***
        const base64DataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file); // Reads file as Base64 data URL
        });

        cachedFile = file;
        cachedBase64 = base64DataUrl.split(',')[1]; // Extracts the Base64 string part

        await new Promise((res) => setTimeout(res, 1000)); // Reduced delay for better UX
        hideUploadBuffer();
    } catch (err) {
        console.error("Error caching file:", err);
        hideUploadBuffer();
        showError("fta-notive-of-submission", "Failed to read file.");
    }
}

async function uploadFileToCRM() {
    if (!cachedFile || !cachedBase64) {
        throw new Error("No cached file for upload.");
    }
    
    if (!app_id) {
         throw new Error("Application ID (app_id) is missing. Cannot attach file.");
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

// --- Main Submission Logic (FIXED) ---

async function update_record(event = null) {
    if (event) event.preventDefault();

    clearErrors();

    let hasError = false;
    const submitBtn = document.getElementById("submit_button_id");
    
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Submitting...";
    }

    // --- Retrieve and Trim Values ---
    const referenceNo = document.getElementById("reference-number")?.value.trim();
    const taxablePerson = document.getElementById("name-of-taxable-person")?.value.trim();
    const taxRegNo = document.getElementById("tax-registration-number")?.value.trim();
    const appDate = document.getElementById("application-date")?.value.trim();
    const safe_account_id = account_id ? account_id.trim() : "";

    // --- Validation Checks ---
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

    // --- Blueprint Proceed BLOCKER ---
    if (hasError) {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = "Submit";
        }
        return;
    }

    // --- Successful Submission Flow ---
    try {
        // 1. Update Application Record
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

        // 2. Execute Deluge Function (Update Account)
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

        // 3. Upload Attachment
        await uploadFileToCRM();

        // 4. Blueprint Proceed (Trigger Transition)
        await ZOHO.CRM.BLUEPRINT.proceed();
        
        /* *** FIX: Removed redundant closeReload() call. ***
         * The Blueprint function handles the UI close after the transition is complete.
         */
        
    } catch (error) {
        console.error("Error on final submit:", error);
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = "Submit";
        }
        showError("submit_button_id", "An unexpected error occurred during submission. See console for details.");
    }
}

// --- Event Listeners and Initialization ---

document.getElementById("fta-notive-of-submission").addEventListener("change", cacheFileOnChange);
document.getElementById("record-form").addEventListener("submit", update_record);


if (!isInitialized) {
    ZOHO.embeddedApp.init().then(() => {
        isInitialized = true;
        console.log("Zoho Embedded App Initialized.");
    });
}