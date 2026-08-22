const localStorageKey = "job-application-tracker-v1";
const migrationKeyPrefix = "job-application-tracker-cloud-migrated-v1";

const statusOptions = [
  "気になる",
  "応募済み",
  "書類選考中",
  "面接予定",
  "面接済み",
  "内定",
  "辞退",
  "落選",
];

let applications = [];
let supabaseClient = null;
let currentUser = null;
let authGeneration = 0;

const els = {
  authView: document.querySelector("#authView"),
  appView: document.querySelector("#appView"),
  authForm: document.querySelector("#authForm"),
  email: document.querySelector("#emailInput"),
  password: document.querySelector("#passwordInput"),
  login: document.querySelector("#loginBtn"),
  signup: document.querySelector("#signupBtn"),
  logout: document.querySelector("#logoutBtn"),
  authMessage: document.querySelector("#authMessage"),
  setupNotice: document.querySelector("#setupNotice"),
  accountInfo: document.querySelector("#accountInfo"),
  accountEmail: document.querySelector("#accountEmail"),
  syncStatus: document.querySelector("#syncStatus"),
  appActions: document.querySelectorAll(".app-action"),
  migrationBanner: document.querySelector("#migrationBanner"),
  migrationText: document.querySelector("#migrationText"),
  migrateLocal: document.querySelector("#migrateLocalBtn"),
  dismissMigration: document.querySelector("#dismissMigrationBtn"),
  pageMessage: document.querySelector("#pageMessage"),
  form: document.querySelector("#applicationForm"),
  save: document.querySelector("#saveBtn"),
  formTitle: document.querySelector("#formTitle"),
  editingId: document.querySelector("#editingId"),
  company: document.querySelector("#companyInput"),
  job: document.querySelector("#jobInput"),
  platform: document.querySelector("#platformInput"),
  category: document.querySelector("#categoryInput"),
  salary: document.querySelector("#salaryInput"),
  salaryDetails: document.querySelector("#salaryDetailsInput"),
  bonus: document.querySelector("#bonusInput"),
  holidays: document.querySelector("#holidaysInput"),
  jobDescription: document.querySelector("#jobDescriptionInput"),
  requirements: document.querySelector("#requirementsInput"),
  workingHours: document.querySelector("#workingHoursInput"),
  location: document.querySelector("#locationInput"),
  appliedDate: document.querySelector("#appliedDateInput"),
  status: document.querySelector("#statusInput"),
  url: document.querySelector("#urlInput"),
  notes: document.querySelector("#notesInput"),
  duplicateAlert: document.querySelector("#duplicateAlert"),
  table: document.querySelector("#applicationTable"),
  rowTemplate: document.querySelector("#rowTemplate"),
  emptyState: document.querySelector("#emptyState"),
  search: document.querySelector("#searchInput"),
  platformFilter: document.querySelector("#platformFilter"),
  statusFilter: document.querySelector("#statusFilter"),
  categoryFilter: document.querySelector("#categoryFilter"),
  sort: document.querySelector("#sortSelect"),
  totalCount: document.querySelector("#totalCount"),
  activeCount: document.querySelector("#activeCount"),
  interviewCount: document.querySelector("#interviewCount"),
  duplicateCount: document.querySelector("#duplicateCount"),
  cancelEdit: document.querySelector("#cancelEditBtn"),
  clearAll: document.querySelector("#clearAllBtn"),
  syncNow: document.querySelector("#syncNowBtn"),
  exportJson: document.querySelector("#exportJsonBtn"),
  exportCsv: document.querySelector("#exportCsvBtn"),
  importJson: document.querySelector("#importJsonInput"),
};

function isConfigured() {
  const config = window.APP_CONFIG || {};
  return Boolean(
    config.supabaseUrl &&
      config.supabasePublishableKey &&
      !config.supabaseUrl.startsWith("YOUR_") &&
      !config.supabasePublishableKey.startsWith("YOUR_"),
  );
}

function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  throw new Error("当前浏览器无法生成安全的记录 ID，请通过 HTTPS 打开应用。");
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/株式会社|有限会社|合同会社|（株）|\(株\)|inc\.?|ltd\.?/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function parseSalary(value) {
  const numbers = String(value || "").match(/\d+/g);
  if (!numbers) return 0;
  return Math.max(...numbers.map(Number));
}

function toDbRecord(item) {
  return {
    id: item.id,
    user_id: currentUser.id,
    company: item.company,
    job_title: item.jobTitle,
    platform: item.platform,
    category: item.category || "",
    salary: item.salary || "",
    salary_details: item.salaryDetails || "",
    bonus: item.bonus || "",
    holidays: item.holidays || "",
    job_description: item.jobDescription || "",
    requirements: item.requirements || "",
    working_hours: item.workingHours || "",
    location: item.location || "",
    applied_date: item.appliedDate,
    status: item.status || "応募済み",
    url: item.url || "",
    notes: item.notes || "",
    updated_at: new Date().toISOString(),
  };
}

function fromDbRecord(item) {
  return {
    id: item.id,
    company: item.company,
    jobTitle: item.job_title,
    platform: item.platform,
    category: item.category || "",
    salary: item.salary || "",
    salaryDetails: item.salary_details || "",
    bonus: item.bonus || "",
    holidays: item.holidays || "",
    jobDescription: item.job_description || "",
    requirements: item.requirements || "",
    workingHours: item.working_hours || "",
    location: item.location || "",
    appliedDate: item.applied_date,
    status: item.status,
    url: item.url || "",
    notes: item.notes || "",
  };
}

function sanitizeImportedRecord(item) {
  if (!item || typeof item !== "object") return null;
  const company = String(item.company || "").trim();
  const jobTitle = String(item.jobTitle || item.job_title || "").trim();
  const platform = String(item.platform || "").trim();
  const appliedDate = String(item.appliedDate || item.applied_date || "").trim();
  if (!company || !jobTitle || !platform || !/^\d{4}-\d{2}-\d{2}$/.test(appliedDate)) return null;

  return {
    id: createId(),
    company,
    jobTitle,
    platform,
    category: String(item.category || "").trim(),
    salary: String(item.salary || "").trim(),
    salaryDetails: String(item.salaryDetails || item.salary_details || "").trim(),
    bonus: String(item.bonus || "").trim(),
    holidays: String(item.holidays || "").trim(),
    jobDescription: String(item.jobDescription || item.job_description || "").trim(),
    requirements: String(item.requirements || "").trim(),
    workingHours: String(item.workingHours || item.working_hours || "").trim(),
    location: String(item.location || "").trim(),
    appliedDate,
    status: statusOptions.includes(item.status) ? item.status : "応募済み",
    url: String(item.url || "").trim(),
    notes: String(item.notes || "").trim(),
  };
}

function setAuthMessage(message, success = false) {
  els.authMessage.textContent = message;
  els.authMessage.classList.toggle("success", success);
}

function setPageMessage(message, isError = false) {
  els.pageMessage.textContent = message;
  els.pageMessage.classList.toggle("hidden", !message);
  els.pageMessage.classList.toggle("error", isError);
}

function setSyncStatus(state, label) {
  els.syncStatus.dataset.state = state;
  els.syncStatus.textContent = label;
}

function setAuthBusy(busy) {
  els.login.disabled = busy;
  els.signup.disabled = busy;
  els.email.disabled = busy;
  els.password.disabled = busy;
}

function setSaveBusy(busy) {
  els.save.disabled = busy;
  els.save.textContent = busy ? "同步中..." : "保存";
}

function showSignedOut() {
  currentUser = null;
  applications = [];
  els.authView.classList.remove("hidden");
  els.appView.classList.add("hidden");
  els.accountInfo.classList.add("hidden");
  els.appActions.forEach((element) => element.classList.add("hidden"));
  els.migrationBanner.classList.add("hidden");
  render();
}

async function showSignedIn(user) {
  const generation = ++authGeneration;
  currentUser = user;
  els.authView.classList.add("hidden");
  els.appView.classList.remove("hidden");
  els.accountInfo.classList.remove("hidden");
  els.appActions.forEach((element) => element.classList.remove("hidden"));
  els.accountEmail.textContent = user.email || "已登录";
  setAuthMessage("");
  resetForm();
  await loadCloudApplications(generation);
  showMigrationOffer();
}

async function loadCloudApplications(generation = authGeneration) {
  setSyncStatus("syncing", "同步中");
  setPageMessage("");
  const { data, error } = await supabaseClient
    .from("applications")
    .select("*")
    .order("applied_date", { ascending: false });

  if (generation !== authGeneration || !currentUser) return;
  if (error) {
    applications = [];
    render();
    setSyncStatus("error", "同步失败");
    setPageMessage(`无法读取云端记录：${friendlyError(error)}`, true);
    return;
  }

  applications = (data || []).map(fromDbRecord);
  render();
  setSyncStatus("idle", "已同步");
}

async function syncNow() {
  if (!currentUser) return;
  els.syncNow.disabled = true;
  await loadCloudApplications();
  els.syncNow.disabled = false;
}

function friendlyError(error) {
  const message = error?.message || String(error || "未知错误");
  if (message.includes("Invalid login credentials")) return "邮箱或密码不正确。";
  if (message.includes("Email not confirmed")) return "请先打开确认邮件完成邮箱验证。";
  if (message.includes("relation") && message.includes("does not exist")) {
    return "数据库表还没有建立，请在 Supabase 执行 supabase.sql。";
  }
  return message;
}

async function signIn(event) {
  event.preventDefault();
  if (!supabaseClient) return;
  setAuthBusy(true);
  setAuthMessage("");
  const { error } = await supabaseClient.auth.signInWithPassword({
    email: els.email.value.trim(),
    password: els.password.value,
  });
  if (error) setAuthMessage(friendlyError(error));
  setAuthBusy(false);
}

async function signUp() {
  if (!els.authForm.reportValidity() || !supabaseClient) return;
  setAuthBusy(true);
  setAuthMessage("");
  const { data, error } = await supabaseClient.auth.signUp({
    email: els.email.value.trim(),
    password: els.password.value,
  });

  if (error) {
    setAuthMessage(friendlyError(error));
  } else if (data.session) {
    setAuthMessage("账号创建成功，正在进入应用。", true);
  } else {
    setAuthMessage("账号已创建，请打开邮箱中的确认链接后登录。", true);
  }
  setAuthBusy(false);
}

async function signOut() {
  els.logout.disabled = true;
  const { error } = await supabaseClient.auth.signOut();
  els.logout.disabled = false;
  if (error) setPageMessage(`退出失败：${friendlyError(error)}`, true);
}

function getDuplicateMatches(candidate) {
  const companyKey = normalizeText(candidate.company);
  const jobKey = normalizeText(candidate.jobTitle);
  if (!companyKey) return [];

  return applications.filter((item) => {
    if (item.id === candidate.id) return false;
    const otherCompany = normalizeText(item.company);
    const otherJob = normalizeText(item.jobTitle);
    const sameCompany =
      otherCompany === companyKey ||
      otherCompany.includes(companyKey) ||
      companyKey.includes(otherCompany);
    const similarJob = jobKey && otherJob && (otherJob.includes(jobKey) || jobKey.includes(otherJob));
    return sameCompany && (!jobKey || similarJob || item.platform !== candidate.platform);
  });
}

function collectFormData() {
  return {
    id: els.editingId.value || createId(),
    company: els.company.value.trim(),
    jobTitle: els.job.value.trim(),
    platform: els.platform.value.trim(),
    category: els.category.value.trim(),
    salary: els.salary.value.trim(),
    salaryDetails: els.salaryDetails.value.trim(),
    bonus: els.bonus.value.trim(),
    holidays: els.holidays.value.trim(),
    jobDescription: els.jobDescription.value.trim(),
    requirements: els.requirements.value.trim(),
    workingHours: els.workingHours.value.trim(),
    location: els.location.value.trim(),
    appliedDate: els.appliedDate.value,
    status: els.status.value,
    url: els.url.value.trim(),
    notes: els.notes.value.trim(),
  };
}

function fillForm(item) {
  els.editingId.value = item.id;
  els.company.value = item.company;
  els.job.value = item.jobTitle;
  els.platform.value = item.platform;
  els.category.value = item.category;
  els.salary.value = item.salary;
  els.salaryDetails.value = item.salaryDetails;
  els.bonus.value = item.bonus;
  els.holidays.value = item.holidays;
  els.jobDescription.value = item.jobDescription;
  els.requirements.value = item.requirements;
  els.workingHours.value = item.workingHours;
  els.location.value = item.location;
  els.appliedDate.value = item.appliedDate;
  els.status.value = item.status;
  els.url.value = item.url;
  els.notes.value = item.notes;
  els.formTitle.textContent = "编辑投递";
  els.cancelEdit.classList.remove("hidden");
  updateDuplicateAlert();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function resetForm() {
  els.form.reset();
  els.editingId.value = "";
  els.appliedDate.value = new Date().toISOString().slice(0, 10);
  els.status.value = "応募済み";
  els.formTitle.textContent = "新增投递";
  els.cancelEdit.classList.add("hidden");
  els.duplicateAlert.classList.add("hidden");
}

function updateDuplicateAlert() {
  const candidate = collectFormData();
  const matches = getDuplicateMatches(candidate);
  if (!matches.length) {
    els.duplicateAlert.classList.add("hidden");
    els.duplicateAlert.textContent = "";
    return;
  }

  const summary = matches
    .slice(0, 3)
    .map((item) => `${item.company} / ${item.jobTitle} / ${item.platform} / ${item.status}`)
    .join("；");
  els.duplicateAlert.textContent = `重复注意：已有 ${matches.length} 条相似记录。${summary}`;
  els.duplicateAlert.classList.remove("hidden");
}

function uniqueValues(key) {
  return [...new Set(applications.map((item) => item[key]).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "ja"),
  );
}

function rebuildFilterOptions() {
  setOptions(els.platformFilter, uniqueValues("platform"), "全部");
  setOptions(els.categoryFilter, uniqueValues("category"), "全部");
  setOptions(els.statusFilter, statusOptions, "全部");
}

function setOptions(select, values, firstLabel) {
  const current = select.value;
  select.innerHTML = "";
  const firstOption = document.createElement("option");
  firstOption.value = "";
  firstOption.textContent = firstLabel;
  select.append(firstOption);
  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.append(option);
  });
  select.value = values.includes(current) ? current : "";
}

function getFilteredApplications() {
  const query = normalizeText(els.search.value);
  const fields = [
    "company",
    "jobTitle",
    "platform",
    "category",
    "salary",
    "salaryDetails",
    "bonus",
    "holidays",
    "jobDescription",
    "requirements",
    "workingHours",
    "location",
    "status",
    "notes",
  ];

  return applications
    .filter((item) => {
      const matchesSearch = !query || fields.some((field) => normalizeText(item[field]).includes(query));
      const matchesPlatform = !els.platformFilter.value || item.platform === els.platformFilter.value;
      const matchesStatus = !els.statusFilter.value || item.status === els.statusFilter.value;
      const matchesCategory = !els.categoryFilter.value || item.category === els.categoryFilter.value;
      return matchesSearch && matchesPlatform && matchesStatus && matchesCategory;
    })
    .sort((a, b) => {
      const [key, direction] = els.sort.value.split("-");
      const modifier = direction === "desc" ? -1 : 1;
      if (key === "salary") return (parseSalary(a.salary) - parseSalary(b.salary)) * modifier;
      return String(a[key] || "").localeCompare(String(b[key] || ""), "ja") * modifier;
    });
}

function updateStats() {
  const activeStatuses = ["応募済み", "書類選考中", "面接予定", "面接済み"];
  const interviewStatuses = ["面接予定", "面接済み", "内定"];
  const duplicateGroups = new Map();
  applications.forEach((item) => {
    const key = normalizeText(item.company);
    if (!key) return;
    duplicateGroups.set(key, (duplicateGroups.get(key) || 0) + 1);
  });

  els.totalCount.textContent = applications.length;
  els.activeCount.textContent = applications.filter((item) => activeStatuses.includes(item.status)).length;
  els.interviewCount.textContent = applications.filter((item) => interviewStatuses.includes(item.status)).length;
  els.duplicateCount.textContent = [...duplicateGroups.values()].filter((count) => count > 1).length;
}

function renderTable() {
  const filtered = getFilteredApplications();
  els.table.innerHTML = "";
  els.emptyState.classList.toggle("hidden", filtered.length > 0);

  filtered.forEach((item) => {
    const fragment = els.rowTemplate.content.cloneNode(true);
    const row = fragment.querySelector(".application-summary-row");
    const detailRow = fragment.querySelector(".application-detail-row");
    row.querySelector(".company-name").textContent = item.company || "-";
    row.querySelector(".job-title").textContent = item.jobTitle || "-";
    row.querySelector(".platform").textContent = item.platform || "-";
    row.querySelector(".salary").textContent = item.salary || "-";
    row.querySelector(".holidays").textContent = item.holidays || "-";
    row.querySelector(".location").textContent = item.location || "-";
    row.querySelector(".applied-date").textContent = item.appliedDate || "-";

    const detailValues = [
      ["給与详细", item.salaryDetails],
      ["賞与", item.bonus],
      ["仕事内容", item.jobDescription],
      ["求める能力・経験", item.requirements],
      ["勤務時間", item.workingHours],
      ["休日・休暇", item.holidays],
      ["工作地点", item.location],
      ["备注", item.notes],
    ].filter(([, value]) => value);
    const detailList = detailRow.querySelector(".job-detail-list");
    detailValues.forEach(([label, value]) => {
      const wrapper = document.createElement("div");
      const term = document.createElement("dt");
      const description = document.createElement("dd");
      term.textContent = label;
      description.textContent = value;
      wrapper.append(term, description);
      detailList.append(wrapper);
    });

    const link = detailRow.querySelector(".job-link");
    if (item.url) link.href = item.url;
    else link.remove();

    const pill = row.querySelector(".status-pill");
    pill.textContent = item.status || "-";
    pill.dataset.status = item.status || "";
    const expandButton = row.querySelector(".expand-btn");
    expandButton.addEventListener("click", () => {
      const isExpanded = expandButton.getAttribute("aria-expanded") === "true";
      expandButton.setAttribute("aria-expanded", String(!isExpanded));
      expandButton.textContent = isExpanded ? "展开" : "收起";
      detailRow.classList.toggle("hidden", isExpanded);
    });
    row.querySelector(".edit-btn").addEventListener("click", () => fillForm(item));
    row.querySelector(".delete-btn").addEventListener("click", () => deleteApplication(item.id));
    els.table.append(fragment);
  });
}

function render() {
  rebuildFilterOptions();
  updateStats();
  renderTable();
}

async function saveApplication(event) {
  event.preventDefault();
  if (!currentUser) return;
  const item = collectFormData();
  const existingIndex = applications.findIndex((entry) => entry.id === item.id);
  setSaveBusy(true);
  setSyncStatus("syncing", "同步中");
  setPageMessage("");

  const query = existingIndex >= 0
    ? supabaseClient.from("applications").update(toDbRecord(item)).eq("id", item.id)
    : supabaseClient.from("applications").insert(toDbRecord(item));
  const { error } = await query;

  if (error) {
    setSyncStatus("error", "同步失败");
    setPageMessage(`保存失败：${friendlyError(error)}`, true);
  } else {
    if (existingIndex >= 0) applications[existingIndex] = item;
    else applications.unshift(item);
    resetForm();
    render();
    setSyncStatus("idle", "已同步");
  }
  setSaveBusy(false);
}

async function deleteApplication(id) {
  const item = applications.find((entry) => entry.id === id);
  if (!item || !confirm(`${item.company} 的记录要删除吗？`)) return;
  setSyncStatus("syncing", "同步中");
  const { error } = await supabaseClient.from("applications").delete().eq("id", id);
  if (error) {
    setSyncStatus("error", "同步失败");
    setPageMessage(`删除失败：${friendlyError(error)}`, true);
    return;
  }
  applications = applications.filter((entry) => entry.id !== id);
  render();
  updateDuplicateAlert();
  setSyncStatus("idle", "已同步");
}

async function clearAllApplications() {
  if (!applications.length || !confirm("云端的所有投递记录都会删除。确定清空吗？")) return;
  setSyncStatus("syncing", "同步中");
  const { error } = await supabaseClient.from("applications").delete().eq("user_id", currentUser.id);
  if (error) {
    setSyncStatus("error", "同步失败");
    setPageMessage(`清空失败：${friendlyError(error)}`, true);
    return;
  }
  applications = [];
  resetForm();
  render();
  setSyncStatus("idle", "已同步");
}

async function uploadRecords(records, successMessage) {
  const sanitized = records.map(sanitizeImportedRecord).filter(Boolean);
  if (!sanitized.length) throw new Error("没有找到格式正确的记录。");
  setSyncStatus("syncing", "同步中");
  const { error } = await supabaseClient.from("applications").insert(sanitized.map(toDbRecord));
  if (error) {
    setSyncStatus("error", "同步失败");
    throw error;
  }
  applications = [...sanitized, ...applications];
  render();
  setSyncStatus("idle", "已同步");
  setPageMessage(successMessage.replace("{count}", sanitized.length));
}

function readLocalApplications() {
  try {
    const parsed = JSON.parse(localStorage.getItem(localStorageKey) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function userMigrationKey() {
  return `${migrationKeyPrefix}-${currentUser.id}`;
}

function showMigrationOffer() {
  const records = readLocalApplications();
  const dismissed = localStorage.getItem(userMigrationKey()) === "done";
  els.migrationBanner.classList.toggle("hidden", !records.length || dismissed);
  els.migrationText.textContent = `共有 ${records.length} 条，可追加上传；本地备份不会被删除。`;
}

async function migrateLocalApplications() {
  const records = readLocalApplications();
  if (!records.length) return;
  els.migrateLocal.disabled = true;
  try {
    await uploadRecords(records, "已将 {count} 条旧记录上传到云端。");
    localStorage.setItem(userMigrationKey(), "done");
    els.migrationBanner.classList.add("hidden");
  } catch (error) {
    setPageMessage(`迁移失败：${friendlyError(error)}`, true);
  } finally {
    els.migrateLocal.disabled = false;
  }
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function toCsvValue(value) {
  return `"${String(value || "").replaceAll('"', '""')}"`;
}

function exportCsv() {
  const headers = [
    "公司名",
    "岗位",
    "平台",
    "职种",
    "年收",
    "給与详细",
    "賞与",
    "休日・休暇",
    "仕事内容",
    "求める能力・経験",
    "勤務時間",
    "工作地点",
    "投递日",
    "状态",
    "求人URL",
    "备注",
  ];
  const rows = applications.map((item) => [
    item.company,
    item.jobTitle,
    item.platform,
    item.category,
    item.salary,
    item.salaryDetails,
    item.bonus,
    item.holidays,
    item.jobDescription,
    item.requirements,
    item.workingHours,
    item.location,
    item.appliedDate,
    item.status,
    item.url,
    item.notes,
  ]);
  const csv = [headers, ...rows].map((row) => row.map(toCsvValue).join(",")).join("\n");
  downloadFile("job-applications.csv", `\ufeff${csv}`, "text/csv;charset=utf-8");
}

async function importJson(event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const imported = JSON.parse(await file.text());
    if (!Array.isArray(imported)) throw new Error("JSON 必须是记录数组。");
    await uploadRecords(imported, "已追加导入 {count} 条记录到云端。");
  } catch (error) {
    setPageMessage(`导入失败：${friendlyError(error)}`, true);
  } finally {
    event.target.value = "";
  }
}

async function initialize() {
  resetForm();
  render();

  if (!isConfigured() || !window.supabase?.createClient) {
    els.setupNotice.classList.remove("hidden");
    els.authForm.querySelectorAll("input, button").forEach((element) => {
      element.disabled = true;
    });
    if (isConfigured()) setAuthMessage("Supabase 程序库加载失败，请检查网络后刷新。");
    return;
  }

  const config = window.APP_CONFIG;
  supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey);
  const { data, error } = await supabaseClient.auth.getSession();
  if (error) setAuthMessage(friendlyError(error));
  if (data?.session?.user) await showSignedIn(data.session.user);
  else showSignedOut();

  supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event === "INITIAL_SESSION") return;
    window.setTimeout(() => {
      if (session?.user) showSignedIn(session.user);
      else {
        authGeneration += 1;
        showSignedOut();
      }
    }, 0);
  });
}

els.authForm.addEventListener("submit", signIn);
els.signup.addEventListener("click", signUp);
els.logout.addEventListener("click", signOut);
els.form.addEventListener("submit", saveApplication);
[els.company, els.job, els.platform].forEach((input) => input.addEventListener("input", updateDuplicateAlert));
[els.search, els.platformFilter, els.statusFilter, els.categoryFilter, els.sort].forEach((input) =>
  input.addEventListener("input", renderTable),
);
els.cancelEdit.addEventListener("click", resetForm);
els.clearAll.addEventListener("click", clearAllApplications);
els.syncNow.addEventListener("click", syncNow);
els.exportJson.addEventListener("click", () => {
  downloadFile("job-applications.json", JSON.stringify(applications, null, 2), "application/json");
});
els.exportCsv.addEventListener("click", exportCsv);
els.importJson.addEventListener("change", importJson);
els.migrateLocal.addEventListener("click", migrateLocalApplications);
els.dismissMigration.addEventListener("click", () => {
  localStorage.setItem(userMigrationKey(), "done");
  els.migrationBanner.classList.add("hidden");
});

initialize();
