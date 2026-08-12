let app_id, account_id, cachedFile, cachedBase64;
let toastTimeout;
const dropZone = document.getElementById("drop-zone");
const fileInput = document.getElementById("fta-notive-of-submission");

function showToast(type, title, message, duration = 4000) {
    const toast = document.getElementById("toast");
    const iconSuccess = document.getElementById("toast-icon-success");
    const iconError = document.getElementById("toast-icon-error");
    const progressBar = document.getElementById("toast-progress-bar");

    document.getElementById("toast-title").textContent = title;
    document.getElementById("toast-message").textContent = message;

    toast.classList.remove("toast-success", "toast-error", "toast-show", "toast-hide", "hidden");
    iconSuccess.classList.toggle("hidden", type !== "success");
    iconError.classList.toggle("hidden", type !== "error");
    toast.classList.add(type === "success" ? "toast-success" : "toast-error");

    // restart slide-in animation
    void toast.offsetWidth;
    toast.classList.add("toast-show");

    // restart progress bar animation
    progressBar.style.animation = "none";
    void progressBar.offsetWidth;
    progressBar.style.animation = `toastProgress ${duration}ms linear forwards`;

    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
        toast.classList.remove("toast-show");
        toast.classList.add("toast-hide");
        setTimeout(() => toast.classList.add("hidden"), 300);
    }, duration);
}

async function finalizeSuccess() {
    try {
        await ZOHO.CRM.BLUEPRINT.proceed();
        setTimeout(() => {
            top.location.href = top.location.href;
        }, 1000);
    } catch (e) {
        ZOHO.CRM.UI.Popup.closeReload();
    }
}

function clearErrors() {
    document.querySelectorAll(".error-message").forEach(s => s.textContent = "");
}

function showError(id, msg) {
    const e = document.getElementById(`error-${id}`);
    if(e) e.textContent = msg;
}

async function handleFile(file) {
    if(!file) return;
    clearErrors();

    if(file.size > 20 * 1024 * 1024) {
        showError("fta-notive-of-submission", "File size must not exceed 20MB.");
        return;
    }

    try {
        // Re-implemented using the Perfect Code logic (ArrayBuffer)
        const content = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsArrayBuffer(file);
        });

        cachedFile = file;
        cachedBase64 = content;
        document.getElementById("file-label-text").textContent = "File: " + file.name;
    } catch (err) {
        console.error("Error reading file:", err);
        showError("fta-notive-of-submission", "Failed to read file.");
    }
}

dropZone.onclick = () => fileInput.click();
fileInput.onchange = (e) => handleFile(e.target.files[0]);
dropZone.ondragover = (e) => { e.preventDefault(); dropZone.classList.add("dragover"); };
dropZone.ondragleave = () => dropZone.classList.remove("dragover");
dropZone.ondrop = (e) => {
    e.preventDefault();
    dropZone.classList.remove("dragover");
    if(e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
};

async function closeWidget() {
    await ZOHO.CRM.UI.Popup.closeReload().catch(() => {
        window.close();
    });
}

ZOHO.embeddedApp.on("PageLoad", async (entity) => {
    try {
        const resp = await ZOHO.CRM.API.getRecord({ Entity: "Applications1", RecordID: entity.EntityId });
        const app = resp.data[0];
        app_id = app.id;
        account_id = app.Account_Name?.id;
        
        if(account_id) {
            const accResp = await ZOHO.CRM.API.getRecord({ Entity: "Accounts", RecordID: account_id });
            const accData = accResp.data[0];
            document.getElementById("name-of-taxable-person").value = accData.Legal_Name_of_Taxable_Person || "";
            document.getElementById("tax-registration-number").value = accData.TRN_Number || "";
        }
    } catch (err) { console.error(err); }
});

document.getElementById("record-form").onsubmit = async (e) => {
    e.preventDefault();
    clearErrors();

    const ref = document.getElementById("reference-number").value.trim();
    const name = document.getElementById("name-of-taxable-person").value.trim();
    const trn = document.getElementById("tax-registration-number").value.trim();
    const date = document.getElementById("application-date").value;

    if(!ref || !name || !trn || !date || !cachedFile || !cachedBase64) {
        if(!ref) showError("reference-number", "Required");
        if(!name) showError("name-of-taxable-person", "Required");
        if(!trn) showError("tax-registration-number", "Required");
        if(!date) showError("application-date", "Required");
        if(!cachedFile) showError("fta-notive-of-submission", "Upload required");
        return;
    }

    const btn = document.getElementById("submit_button_id");
    btn.disabled = true;
    btn.textContent = "Submitting...";
    document.getElementById("upload-buffer").classList.remove("hidden");
    document.getElementById("upload-progress").classList.add("animate");

    try {
        await ZOHO.CRM.API.updateRecord({
            Entity: "Applications1",
            APIData: { 
                id: app_id, 
                Reference_Number: ref, 
                Legal_Name_of_Taxable_Person: name, 
                Tax_Registration_Number_TRN: trn, 
                Application_Date: date 
            }
        });

        await ZOHO.CRM.FUNCTIONS.execute("ta_vatdr_submit_to_auth_update_account", {
            arguments: JSON.stringify({ account_id, legal_name_of_taxable_person: name, trn_number: trn })
        });

        // Re-implemented Attachment
        await ZOHO.CRM.API.attachFile({
            Entity: "Applications1",
            RecordID: app_id,
            File: { 
                Name: cachedFile.name, 
                Content: cachedBase64 
            }
        });

        document.getElementById("upload-buffer").classList.add("hidden");
        showToast("success", "Success!", "Application processed successfully.");
        setTimeout(() => { finalizeSuccess(); }, 2500);
    } catch (err) {
        btn.disabled = false;
        btn.textContent = "Submit";
        document.getElementById("upload-buffer").classList.add("hidden");
        showToast("error", "Failed", "Check connection and try again.");
    }
};

ZOHO.embeddedApp.init();