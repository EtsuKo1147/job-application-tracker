const localStorageKey = "job-application-tracker-v1";
const migrationKeyPrefix = "job-application-tracker-cloud-migrated-v1";
const interviewMarkerPrefix = "[[INTERVIEW_SCHEDULE:";

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
let quickFilter = null;
let calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let selectedCalendarDate = todayDateKey();

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
  interviewAt: document.querySelector("#interviewAtInput"),
  interviewMemo: document.querySelector("#interviewMemoInput"),
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
  ongoingCount: document.querySelector("#ongoingCount"),
  watchingCount: document.querySelector("#watchingCount"),
  interviewCount: document.querySelector("#interviewCount"),
  closedCount: document.querySelector("#closedCount"),
  ongoingStat: document.querySelector("#ongoingStatBtn"),
  watchingStat: document.querySelector("#watchingStatBtn"),
  interviewStat: document.querySelector("#interviewStatBtn"),
  closedStat: document.querySelector("#closedStatBtn"),
  interviewDialog: document.querySelector("#interviewDialog"),
  closeInterviewDialog: document.querySelector("#closeInterviewDialogBtn"),
  previousMonth: document.querySelector("#previousMonthBtn"),
  nextMonth: document.querySelector("#nextMonthBtn"),
  calendarMonthLabel: document.querySelector("#calendarMonthLabel"),
  calendarGrid: document.querySelector("#calendarGrid"),
  agendaDateLabel: document.querySelector("#agendaDateLabel"),
  agendaCount: document.querySelector("#agendaCount"),
  agendaList: document.querySelector("#agendaList"),
  interviewForm: document.querySelector("#interviewForm"),
  interviewEditingId: document.querySelector("#interviewEditingId"),
  interviewApplication: document.querySelector("#interviewApplicationSelect"),
  interviewDateTime: document.querySelector("#interviewDateTimeInput"),
  interviewScheduleMemo: document.querySelector("#interviewScheduleMemoInput"),
  cancelInterviewEdit: document.querySelector("#cancelInterviewEditBtn"),
  saveInterview: document.querySelector("#saveInterviewBtn"),
  cancelEdit: document.querySelector("#cancelEditBtn"),
  clearAll: document.querySelector("#clearAllBtn"),
  syncNow: document.querySelector("#syncNowBtn"),
  exportJson: document.querySelector("#exportJsonBtn"),
  exportCsv: document.querySelector("#exportCsvBtn"),
  importJson: document.querySelector("#importJsonInput"),
  topbar: document.querySelector(".topbar"),
  mobileMenu: document.querySelector("#mobileMenuBtn"),
  controlBand: document.querySelector("#controlBand"),
  mobileFilterButtons: document.querySelectorAll(".filter-chip"),
  openApplicationForm: document.querySelector("#openApplicationFormBtn"),
  closeApplicationForm: document.querySelector("#closeApplicationFormBtn"),
};

const mobileViewport = window.matchMedia("(max-width: 760px)");

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

function normalizeSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function parseSalary(value) {
  const numbers = String(value || "").match(/\d+/g);
  if (!numbers) return 0;
  return Math.max(...numbers.map(Number));
}

function parseStoredNotes(value) {
  const raw = String(value || "");
  const markerIndex = raw.lastIndexOf(interviewMarkerPrefix);
  if (markerIndex < 0 || !raw.endsWith("]]")) {
    return { notes: raw, interviewAt: "", interviewMemo: "" };
  }

  try {
    const encoded = raw.slice(markerIndex + interviewMarkerPrefix.length, -2);
    const schedule = JSON.parse(decodeURIComponent(encoded));
    return {
      notes: raw.slice(0, markerIndex).trimEnd(),
      interviewAt: String(schedule.at || ""),
      interviewMemo: String(schedule.memo || ""),
    };
  } catch {
    return { notes: raw, interviewAt: "", interviewMemo: "" };
  }
}

function serializeStoredNotes(notes, interviewAt, interviewMemo) {
  const cleanNotes = String(notes || "").trimEnd();
  if (!interviewAt) return cleanNotes;
  const encoded = encodeURIComponent(JSON.stringify({ at: interviewAt, memo: interviewMemo || "" }));
  return `${cleanNotes}${cleanNotes ? "\n\n" : ""}${interviewMarkerPrefix}${encoded}]]`;
}

function localDateKey(value) {
  return String(value || "").slice(0, 10);
}

function todayDateKey() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}

function formatInterviewDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
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
    notes: serializeStoredNotes(item.notes, item.interviewAt, item.interviewMemo),
    updated_at: new Date().toISOString(),
  };
}

function fromDbRecord(item) {
  const storedNotes = parseStoredNotes(item.notes);
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
    notes: storedNotes.notes,
    interviewAt: storedNotes.interviewAt,
    interviewMemo: storedNotes.interviewMemo,
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
    notes: parseStoredNotes(item.notes).notes.trim(),
    interviewAt: String(item.interviewAt || item.interview_at || parseStoredNotes(item.notes).interviewAt || "").trim(),
    interviewMemo: String(item.interviewMemo || item.interview_memo || parseStoredNotes(item.notes).interviewMemo || "").trim(),
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
  els.mobileMenu.classList.add("hidden");
  els.topbar.classList.remove("mobile-menu-open");
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
  els.mobileMenu.classList.remove("hidden");
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
    interviewAt: els.interviewAt.value,
    interviewMemo: els.interviewMemo.value,
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
  els.interviewAt.value = item.interviewAt || "";
  els.interviewMemo.value = item.interviewMemo || "";
  els.url.value = item.url;
  els.notes.value = item.notes;
  els.formTitle.textContent = "编辑投递";
  els.cancelEdit.classList.remove("hidden");
  updateDuplicateAlert();
  openMobileApplicationForm();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function resetForm() {
  els.form.reset();
  els.editingId.value = "";
  els.interviewAt.value = "";
  els.interviewMemo.value = "";
  els.appliedDate.value = todayDateKey();
  els.status.value = "応募済み";
  els.formTitle.textContent = "新增投递";
  els.cancelEdit.classList.add("hidden");
  els.duplicateAlert.classList.add("hidden");
}

function openMobileApplicationForm() {
  if (!mobileViewport.matches) return;
  els.form.classList.add("mobile-form-open");
  document.body.classList.add("mobile-overlay-open");
  window.setTimeout(() => els.company.focus(), 0);
}

function closeMobileApplicationForm() {
  els.form.classList.remove("mobile-form-open");
  document.body.classList.remove("mobile-overlay-open");
}

function toggleMobileMenu() {
  const isOpen = els.topbar.classList.toggle("mobile-menu-open");
  els.mobileMenu.setAttribute("aria-expanded", String(isOpen));
  els.mobileMenu.setAttribute("aria-label", isOpen ? "关闭账户菜单" : "打开账户菜单");
}

function updateMobileFilterButtons() {
  const values = {
    search: els.search.value.trim(),
    platform: els.platformFilter.value,
    status: els.statusFilter.value,
    category: els.categoryFilter.value,
    sort: els.sort.options[els.sort.selectedIndex]?.text || "",
  };

  els.mobileFilterButtons.forEach((button) => {
    const value = values[button.dataset.filterTarget];
    const fallback = button.dataset.defaultLabel;
    const isDefaultSort = button.dataset.filterTarget === "sort" && els.sort.selectedIndex === 0;
    button.textContent = value && !isDefaultSort ? `${fallback}：${value}` : fallback;
    button.classList.toggle("has-value", Boolean(value && !isDefaultSort));
  });
}

function toggleMobileFilter(button) {
  const target = button.dataset.filterTarget;
  const isOpen = els.controlBand.dataset.openFilter === target;
  els.controlBand.dataset.openFilter = isOpen ? "" : target;
  els.mobileFilterButtons.forEach((item) => {
    item.setAttribute("aria-expanded", String(!isOpen && item === button));
  });
  if (!isOpen && target === "search") window.setTimeout(() => els.search.focus(), 0);
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
  const query = normalizeSearchText(els.search.value);

  return applications
    .filter((item) => {
      const matchesSearch = !query || normalizeSearchText(item.company).includes(query);
      const matchesPlatform = !els.platformFilter.value || item.platform === els.platformFilter.value;
      const matchesStatus = !els.statusFilter.value || item.status === els.statusFilter.value;
      const matchesCategory = !els.categoryFilter.value || item.category === els.categoryFilter.value;
      const matchesQuickFilter =
        !quickFilter ||
        (quickFilter === "ongoing" && !["辞退", "落選", "気になる"].includes(item.status)) ||
        (quickFilter === "watching" && item.status === "気になる") ||
        (quickFilter === "closed" && ["辞退", "落選"].includes(item.status));
      return matchesSearch && matchesPlatform && matchesStatus && matchesCategory && matchesQuickFilter;
    })
    .sort((a, b) => {
      const [key, direction] = els.sort.value.split("-");
      const modifier = direction === "desc" ? -1 : 1;
      if (key === "salary") return (parseSalary(a.salary) - parseSalary(b.salary)) * modifier;
      return String(a[key] || "").localeCompare(String(b[key] || ""), "ja") * modifier;
    });
}

function updateStats() {
  els.ongoingCount.textContent = applications.filter(
    (item) => !["辞退", "落選", "気になる"].includes(item.status),
  ).length;
  els.watchingCount.textContent = applications.filter((item) => item.status === "気になる").length;
  els.interviewCount.textContent = getScheduledApplications().length;
  els.closedCount.textContent = applications.filter((item) => ["辞退", "落選"].includes(item.status)).length;
  els.ongoingStat.setAttribute("aria-pressed", String(quickFilter === "ongoing"));
  els.watchingStat.setAttribute("aria-pressed", String(quickFilter === "watching"));
  els.closedStat.setAttribute("aria-pressed", String(quickFilter === "closed"));
}

function setQuickFilter(filter) {
  quickFilter = quickFilter === filter ? null : filter;
  els.search.value = "";
  els.platformFilter.value = "";
  els.statusFilter.value = "";
  els.categoryFilter.value = "";
  render();
}

function getScheduledApplications() {
  return applications
    .filter((item) => item.interviewAt && !["落選", "辞退"].includes(item.status))
    .sort((a, b) => String(a.interviewAt).localeCompare(String(b.interviewAt)));
}

function rebuildInterviewApplicationOptions(selectedId = "") {
  const current = selectedId || els.interviewApplication.value;
  els.interviewApplication.innerHTML = "";
  applications
    .slice()
    .sort((a, b) => a.company.localeCompare(b.company, "ja"))
    .forEach((item) => {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = `${item.company} / ${item.jobTitle}`;
      els.interviewApplication.append(option);
    });
  if (applications.some((item) => item.id === current)) els.interviewApplication.value = current;
}

function resetInterviewForm(date = selectedCalendarDate) {
  els.interviewForm.reset();
  els.interviewEditingId.value = "";
  rebuildInterviewApplicationOptions();
  els.interviewDateTime.value = `${date}T10:00`;
  els.cancelInterviewEdit.classList.add("hidden");
  els.saveInterview.textContent = "保存面试安排";
}

function startInterviewEdit(item) {
  els.interviewEditingId.value = item.id;
  rebuildInterviewApplicationOptions(item.id);
  els.interviewApplication.value = item.id;
  els.interviewDateTime.value = item.interviewAt;
  els.interviewScheduleMemo.value = item.interviewMemo || "";
  els.cancelInterviewEdit.classList.remove("hidden");
  els.saveInterview.textContent = "更新面试安排";
}

function openInterviewCalendar() {
  const upcoming = getScheduledApplications().find((item) => new Date(item.interviewAt) >= new Date());
  const focusDate = upcoming?.interviewAt || todayDateKey();
  selectedCalendarDate = localDateKey(focusDate);
  const parsedDate = new Date(`${selectedCalendarDate}T00:00:00`);
  calendarMonth = new Date(parsedDate.getFullYear(), parsedDate.getMonth(), 1);
  resetInterviewForm();
  renderInterviewCalendar();
  els.interviewDialog.showModal();
}

function renderInterviewCalendar() {
  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const schedules = getScheduledApplications();
  const today = todayDateKey();
  els.calendarMonthLabel.textContent = `${year}年 ${month + 1}月`;
  els.calendarGrid.innerHTML = "";

  for (let index = 0; index < 42; index += 1) {
    const day = index - firstWeekday + 1;
    if (day < 1 || day > daysInMonth) {
      const empty = document.createElement("span");
      empty.className = "calendar-day empty";
      els.calendarGrid.append(empty);
      continue;
    }

    const dateKey = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const count = schedules.filter((item) => localDateKey(item.interviewAt) === dateKey).length;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "calendar-day";
    button.dataset.date = dateKey;
    button.setAttribute("aria-pressed", String(dateKey === selectedCalendarDate));
    if (dateKey === today) button.classList.add("today");

    const dayNumber = document.createElement("span");
    dayNumber.textContent = String(day);
    button.append(dayNumber);
    if (count) {
      const badge = document.createElement("strong");
      badge.textContent = String(count);
      badge.setAttribute("aria-label", `${count} 场面试`);
      button.append(badge);
    }

    button.addEventListener("click", () => {
      selectedCalendarDate = dateKey;
      if (!els.interviewEditingId.value) els.interviewDateTime.value = `${dateKey}T10:00`;
      renderInterviewCalendar();
    });
    els.calendarGrid.append(button);
  }

  renderInterviewAgenda();
}

function renderInterviewAgenda() {
  const date = new Date(`${selectedCalendarDate}T00:00:00`);
  els.agendaDateLabel.textContent = new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(date);
  const items = getScheduledApplications().filter(
    (item) => localDateKey(item.interviewAt) === selectedCalendarDate,
  );
  els.agendaCount.textContent = items.length ? `${items.length} 场` : "";
  els.agendaList.innerHTML = "";

  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "agenda-empty";
    empty.textContent = "这一天还没有面试安排";
    els.agendaList.append(empty);
    return;
  }

  items.forEach((item) => {
    const row = document.createElement("article");
    row.className = "agenda-item";
    const content = document.createElement("div");
    const time = document.createElement("time");
    time.dateTime = item.interviewAt;
    time.textContent = formatInterviewDateTime(item.interviewAt);
    const company = document.createElement("strong");
    company.textContent = item.company;
    const job = document.createElement("span");
    job.textContent = item.jobTitle;
    content.append(time, company, job);
    if (item.interviewMemo) {
      const memo = document.createElement("p");
      memo.textContent = item.interviewMemo;
      content.append(memo);
    }

    const actions = document.createElement("div");
    actions.className = "agenda-actions";
    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "text-button compact-button";
    editButton.textContent = "编辑";
    editButton.addEventListener("click", () => startInterviewEdit(item));
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "icon-button";
    deleteButton.title = "删除面试时间";
    deleteButton.setAttribute("aria-label", `删除 ${item.company} 的面试时间`);
    deleteButton.textContent = "×";
    deleteButton.addEventListener("click", () => deleteInterviewSchedule(item));
    actions.append(editButton, deleteButton);
    row.append(content, actions);
    els.agendaList.append(row);
  });
}

async function saveInterviewSchedule(event) {
  event.preventDefault();
  const item = applications.find((entry) => entry.id === els.interviewApplication.value);
  if (!item || !els.interviewDateTime.value) return;
  const interviewAt = els.interviewDateTime.value;
  const interviewMemo = els.interviewScheduleMemo.value.trim();
  els.saveInterview.disabled = true;
  els.saveInterview.textContent = "同步中...";
  setSyncStatus("syncing", "同步中");

  const { error } = await supabaseClient
    .from("applications")
    .update({
      status: "面接予定",
      notes: serializeStoredNotes(item.notes, interviewAt, interviewMemo),
      updated_at: new Date().toISOString(),
    })
    .eq("id", item.id);

  if (error) {
    setSyncStatus("error", "同步失败");
    setPageMessage(`面试安排保存失败：${friendlyError(error)}`, true);
    els.saveInterview.disabled = false;
    els.saveInterview.textContent = els.interviewEditingId.value ? "更新面试安排" : "保存面试安排";
    return;
  }

  item.status = "面接予定";
  item.interviewAt = interviewAt;
  item.interviewMemo = interviewMemo;
  selectedCalendarDate = localDateKey(interviewAt);
  const scheduledDate = new Date(`${selectedCalendarDate}T00:00:00`);
  calendarMonth = new Date(scheduledDate.getFullYear(), scheduledDate.getMonth(), 1);
  setSyncStatus("idle", "已同步");
  render();
  resetInterviewForm();
  renderInterviewCalendar();
  els.saveInterview.disabled = false;
}

async function deleteInterviewSchedule(item) {
  if (!confirm(`删除 ${item.company} 的面试时间吗？`)) return;
  setSyncStatus("syncing", "同步中");
  const { error } = await supabaseClient
    .from("applications")
    .update({
      notes: serializeStoredNotes(item.notes, "", ""),
      updated_at: new Date().toISOString(),
    })
    .eq("id", item.id);
  if (error) {
    setSyncStatus("error", "同步失败");
    setPageMessage(`面试安排删除失败：${friendlyError(error)}`, true);
    return;
  }
  item.interviewAt = "";
  item.interviewMemo = "";
  setSyncStatus("idle", "已同步");
  render();
  resetInterviewForm();
  renderInterviewCalendar();
}

function renderTable() {
  const filtered = getFilteredApplications();
  els.table.innerHTML = "";
  els.emptyState.classList.toggle("hidden", filtered.length > 0);

  filtered.forEach((item) => {
    const fragment = els.rowTemplate.content.cloneNode(true);
    const row = fragment.querySelector(".application-summary-row");
    const detailRow = fragment.querySelector(".application-detail-row");
    row.dataset.id = item.id;
    row.dataset.status = item.status || "応募済み";
    row.querySelector(".company-name").textContent = item.company || "-";
    row.querySelector(".job-title").textContent = item.jobTitle || "-";
    row.querySelector(".platform").textContent = item.platform || "-";
    row.querySelector(".salary").textContent = item.salary || "-";
    row.querySelector(".holidays").textContent = item.holidays || "-";
    row.querySelector(".location").textContent = item.location || "-";
    row.querySelector(".applied-date").textContent = item.appliedDate || "-";
    row.querySelector(".mobile-salary").textContent = item.salary || "年收未填写";
    row.querySelector(".mobile-location").textContent = item.location || "地点未填写";
    row.querySelector(".mobile-platform-date").textContent = `${item.platform || "平台未填写"} · ${item.appliedDate || "日期未填写"}`;

    const detailValues = [
      ["面接予定", item.interviewAt ? `${formatInterviewDateTime(item.interviewAt)}${item.interviewMemo ? ` / ${item.interviewMemo}` : ""}` : ""],
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

    const statusSelect = row.querySelector(".status-select");
    statusOptions.forEach((status) => {
      const option = document.createElement("option");
      option.value = status;
      option.textContent = status;
      statusSelect.append(option);
    });
    statusSelect.value = item.status || "応募済み";
    statusSelect.dataset.status = item.status || "応募済み";
    statusSelect.setAttribute("aria-label", `${item.company}：更改状态`);
    statusSelect.addEventListener("change", () => updateApplicationStatus(item, statusSelect));
    const expandButton = row.querySelector(".expand-btn");
    const toggleDetails = () => {
      const isExpanded = expandButton.getAttribute("aria-expanded") === "true";
      expandButton.setAttribute("aria-expanded", String(!isExpanded));
      expandButton.textContent = isExpanded ? "展开" : "收起";
      detailRow.classList.toggle("hidden", isExpanded);
      row.classList.toggle("is-expanded", !isExpanded);
    };
    expandButton.addEventListener("click", toggleDetails);
    row.tabIndex = 0;
    row.setAttribute("aria-label", `${item.company}，${item.jobTitle}，点击展开详细信息`);
    row.addEventListener("click", (event) => {
      if (!mobileViewport.matches || event.target.closest("button, select, a, input, label")) return;
      toggleDetails();
    });
    row.addEventListener("keydown", (event) => {
      if (!mobileViewport.matches || !["Enter", " "].includes(event.key)) return;
      event.preventDefault();
      toggleDetails();
    });
    row.querySelector(".edit-btn").addEventListener("click", () => fillForm(item));
    row.querySelector(".delete-btn").addEventListener("click", () => deleteApplication(item.id));
    els.table.append(fragment);
  });
}

async function updateApplicationStatus(item, select) {
  if (!currentUser || select.disabled) return;
  const previousStatus = item.status;
  const nextStatus = select.value;
  if (nextStatus === previousStatus) return;

  select.disabled = true;
  select.dataset.status = nextStatus;
  setSyncStatus("syncing", "同步中");
  setPageMessage("");

  const { error } = await supabaseClient
    .from("applications")
    .update({ status: nextStatus, updated_at: new Date().toISOString() })
    .eq("id", item.id);

  if (error) {
    select.value = previousStatus;
    select.dataset.status = previousStatus;
    select.disabled = false;
    setSyncStatus("error", "同步失败");
    setPageMessage(`状态更新失败：${friendlyError(error)}`, true);
    return;
  }

  item.status = nextStatus;
  setSyncStatus("idle", "已同步");
  render();
  updateDuplicateAlert();
}

function render() {
  rebuildFilterOptions();
  updateStats();
  renderTable();
  updateMobileFilterButtons();
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
    closeMobileApplicationForm();
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
    "面试日期时间",
    "面试备注",
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
    item.interviewAt,
    item.interviewMemo,
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
[els.platformFilter, els.categoryFilter, els.sort].forEach((input) => input.addEventListener("input", render));
els.search.addEventListener("input", () => {
  quickFilter = null;
  render();
});
els.statusFilter.addEventListener("input", () => {
  quickFilter = null;
  render();
});
els.ongoingStat.addEventListener("click", () => setQuickFilter("ongoing"));
els.watchingStat.addEventListener("click", () => setQuickFilter("watching"));
els.closedStat.addEventListener("click", () => setQuickFilter("closed"));
els.interviewStat.addEventListener("click", openInterviewCalendar);
els.closeInterviewDialog.addEventListener("click", () => els.interviewDialog.close());
els.previousMonth.addEventListener("click", () => {
  calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1);
  renderInterviewCalendar();
});
els.nextMonth.addEventListener("click", () => {
  calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1);
  renderInterviewCalendar();
});
els.interviewForm.addEventListener("submit", saveInterviewSchedule);
els.cancelInterviewEdit.addEventListener("click", () => resetInterviewForm());
els.interviewDialog.addEventListener("click", (event) => {
  if (event.target === els.interviewDialog) els.interviewDialog.close();
});
els.cancelEdit.addEventListener("click", () => {
  resetForm();
  closeMobileApplicationForm();
});
els.mobileMenu.addEventListener("click", toggleMobileMenu);
els.mobileFilterButtons.forEach((button) => button.addEventListener("click", () => toggleMobileFilter(button)));
els.openApplicationForm.addEventListener("click", () => {
  resetForm();
  openMobileApplicationForm();
});
els.closeApplicationForm.addEventListener("click", () => {
  resetForm();
  closeMobileApplicationForm();
});
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
