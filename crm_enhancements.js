(function(){
var COMPANY = {
  name: 'Hominal Healthcare Pvt. Ltd.',
  brand: 'Hominal Healthcare',
  tagline: 'We Care How You Live',
  address: 'A,407 Shivalik Yash, Opp. Shastrinagar BRTS, Naranpura, Ahmedabad-380013',
  shortAddress: 'A,407 Shivalik Yash, Naranpura, Ahmedabad-380013',
  phone: '7211136600',
  email: 'care@hominalhealthcare.in',
  site: 'crm.hominalhealthcare.com'
};

var EDUCATION_OPTIONS = ['Illiterate','Below 10th Pass','10th Pass','12th Pass','ITI','Diploma','Graduate','B.Sc Nursing','GNM','ANM','MBBS','MD','BPT'];
var SHIFT_OPTIONS = ['Day Shift (9:00 AM – 7:00 PM)','Night Shift (8:00 PM – 8:00 AM)','24 Hours Shift'];
var DESIGNATION_OPTIONS = ['Doctor','Nurse','Attendant','Supervisor','Executive','Account'];
var EMPLOYEE_TYPES = ['Nurse','Attendant'];
var EMPLOYEE_DOC_TYPES = ['Aadhar Card','PAN Card','Photo ID','Any Other Document'];
var EMPLOYEE_JOB_PROFILES = ['Patient Care','Ryles Tube Feeding','Diaper Management','Suction Catheter','Catheter Care','IV Line','Dressing Change','Baby Care','Maternity Care','Elder Care','Post Operative Care','Physiotherapy Support','Ventilator Support','Bedridden Care'];
var PATIENT_STATUSES = ['Active','Closed','Paused','Deceased','Discharged'];
var BILL_CLOSE_REASONS = ['Recovered','Transferred','Deceased','Discontinued','Cost Issues','Other'];
var INQUIRY_SOURCES = ['Facebook','Instagram','Just Dial','Walk-in','Website','IndiaMART','WhatsApp','Google Ads','YouTube','Doctor Referral','Patient Referral','Personal / Word of Mouth','Other Social Media','Other'];
var REPORT_TYPES = ['patient-billing','employee-payout','profit-loss','inquiry-conversion','attendance-service'];
var EXTRA_SYNC_CACHE = { auditLoaded:false, settingsLoaded:false };
var currentInquiryShareId = null;
var currentInquiryShareMaskPhone = false;
var pendingPaymentProof = null;
var EMP_AREA_LIST = [];

function getLogoSrc() {
  return LOGO_SRC || (window.HOMINAL_SUPABASE_CONFIG && window.HOMINAL_SUPABASE_CONFIG.logo) || '';
}

function ensureExtraState() {
  if (!DB.auditLogs) DB.auditLogs = [];
  if (!DB.settings) DB.settings = { signature:'', seal:'', signatoryName:'Authorised Signatory', signatoryTitle:'Authorised Signatory' };
}

function getCurrentUser() {
  var session = getSession();
  if (session && session.user) return session.user;
  return { id:'u0', username:'System', role:'Admin' };
}

function formatStampDateTime(value) {
  var d = value instanceof Date ? value : new Date(value || Date.now());
  if (isNaN(d)) d = new Date();
  return d.toLocaleString('en-IN', {
    day:'2-digit',
    month:'short',
    year:'numeric',
    hour:'2-digit',
    minute:'2-digit',
    hour12:true
  });
}

function buildStampText(prefix) {
  var user = getCurrentUser();
  return prefix + ' by ' + (user.username || 'System') + ' on ' + formatStampDateTime(new Date());
}

function toSbAuditLog(log) {
  return {
    id: log.id,
    entity_type: log.entityType,
    entity_id: log.entityId,
    action: log.action,
    stamp_text: log.stampText,
    actor_user_id: log.actorUserId,
    actor_username: log.actorUsername,
    created: log.created,
    meta: log.meta || {}
  };
}

function toSbAppSetting(settingKey) {
  return {
    key: settingKey,
    value: DB.settings[settingKey]
  };
}

async function loadExtraSupabaseStores() {
  ensureExtraState();
  if (SB_READY && !EXTRA_SYNC_CACHE.auditLoaded) {
    var auditRows = await sbGet('hh_audit_logs');
    if (Array.isArray(auditRows) && auditRows.length) {
      DB.auditLogs = auditRows.map(function(row){
        return {
          id: row.id,
          entityType: row.entity_type,
          entityId: row.entity_id,
          action: row.action,
          stampText: row.stamp_text,
          actorUserId: row.actor_user_id,
          actorUsername: row.actor_username,
          created: row.created,
          meta: row.meta || {}
        };
      });
    }
    EXTRA_SYNC_CACHE.auditLoaded = true;
  }
  if (SB_READY && !EXTRA_SYNC_CACHE.settingsLoaded) {
    var settingsRows = await sbGet('hh_app_settings');
    if (Array.isArray(settingsRows) && settingsRows.length) {
      settingsRows.forEach(function(row){
        DB.settings[row.key] = row.value;
      });
    }
    EXTRA_SYNC_CACHE.settingsLoaded = true;
  }
}

function saveSettingsToSupabase() {
  if (!SB_READY) return;
  ['signature','seal','signatoryName','signatoryTitle'].forEach(function(settingKey){
    sbUpsert('hh_app_settings', [toSbAppSetting(settingKey)]);
  });
}

function recordAudit(entityType, entityId, action, stampText, meta) {
  ensureExtraState();
  var user = getCurrentUser();
  var row = {
    id: 'AUD' + Date.now() + Math.floor(Math.random() * 10000),
    entityType: entityType,
    entityId: String(entityId || ''),
    action: action,
    stampText: stampText,
    actorUserId: user.id || '',
    actorUsername: user.username || 'System',
    created: formatStampDateTime(new Date()),
    meta: meta || {}
  };
  DB.auditLogs.unshift(row);
  if (SB_READY) sbUpsert('hh_audit_logs', [toSbAuditLog(row)]);
  saveDB();
  return row;
}

function getAuditEntries(entityType, entityId) {
  ensureExtraState();
  return (DB.auditLogs || []).filter(function(row){
    return row.entityType === entityType && String(row.entityId) === String(entityId);
  });
}

function getLatestAudit(entityType, entityId, actionPrefix) {
  var entries = getAuditEntries(entityType, entityId);
  var i;
  for (i = 0; i < entries.length; i++) {
    if (!actionPrefix || String(entries[i].action || '').indexOf(actionPrefix) === 0) return entries[i];
  }
  return null;
}

function getStampLines(entityType, entityId) {
  var lines = [];
  var created = getLatestAudit(entityType, entityId, 'create');
  var edited = getLatestAudit(entityType, entityId, 'edit');
  if (created) lines.push(created.stampText);
  if (edited) lines.push(edited.stampText);
  return lines;
}

function getAreaOptions() {
  var seen = {};
  var list = [];
  Object.keys(PATIENT_PINCODE_MAP || {}).forEach(function(pin){
    var item = PATIENT_PINCODE_MAP[pin];
    if (!item) return;
    if (!seen[item.area]) {
      seen[item.area] = true;
      list.push(item.area);
    }
  });
  return list.sort();
}

function clearElement(el) {
  if (!el) return;
  while (el.firstChild) el.removeChild(el.firstChild);
}

function createTextNodeEl(tag, text, className) {
  var el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== null && text !== undefined) el.textContent = text;
  return el;
}

function createButton(label, className, handler, type) {
  var btn = document.createElement('button');
  btn.type = type || 'button';
  btn.className = className || 'btn btn-ghost btn-xs';
  btn.textContent = label;
  if (handler) btn.addEventListener('click', handler);
  return btn;
}

function createLink(label, href, className) {
  var link = document.createElement('a');
  link.className = className || '';
  link.textContent = label;
  link.href = href || '#';
  link.target = '_blank';
  link.rel = 'noopener';
  return link;
}

function createBadge(text, className) {
  var badge = document.createElement('span');
  badge.className = 'badge ' + (className || 'bg-gray');
  badge.textContent = text;
  return badge;
}

function createActionCell(actions) {
  var td = document.createElement('td');
  td.className = 'td-acts';
  actions.forEach(function(node){
    td.appendChild(node);
  });
  return td;
}

function createTd(content, className) {
  var td = document.createElement('td');
  if (className) td.className = className;
  if (typeof content === 'string' || typeof content === 'number') td.textContent = content;
  else if (content) td.appendChild(content);
  return td;
}

function createDualLine(primary, secondaryNode) {
  var wrap = document.createElement('div');
  var name = createTextNodeEl('div', primary, 'td-name');
  wrap.appendChild(name);
  if (secondaryNode) wrap.appendChild(secondaryNode);
  return wrap;
}

function setOptions(select, values, placeholder) {
  if (!select) return;
  clearElement(select);
  if (placeholder !== null && placeholder !== undefined) {
    var opt = document.createElement('option');
    opt.value = '';
    opt.textContent = placeholder;
    select.appendChild(opt);
  }
  values.forEach(function(value){
    var opt = document.createElement('option');
    opt.value = value;
    opt.textContent = value;
    select.appendChild(opt);
  });
}

function ensureDatalist(inputId, listId, values) {
  var input = document.getElementById(inputId);
  if (!input) return;
  input.setAttribute('list', listId);
  var existing = document.getElementById(listId);
  if (existing) existing.parentNode.removeChild(existing);
  var dl = document.createElement('datalist');
  dl.id = listId;
  values.forEach(function(value){
    var opt = document.createElement('option');
    opt.value = value;
    dl.appendChild(opt);
  });
  document.body.appendChild(dl);
}

function setSliderOutput(sliderId, outputId) {
  var slider = document.getElementById(sliderId);
  var output = document.getElementById(outputId);
  if (!slider || !output) return;
  output.textContent = slider.value;
}

function getEmployeeProfileOptions() {
  return EMPLOYEE_JOB_PROFILES.slice();
}

function calculateEmployeeScore(data) {
  var a = parseFloat(data.scoreExperience || 0) || 0;
  var b = parseFloat(data.scoreBehaviour || 0) || 0;
  var c = parseFloat(data.scoreTestimonial || 0) || 0;
  return ((a + b + c) / 3).toFixed(1);
}

function getEmployeeFilterValues() {
  return {
    type: gv('empTypeFilter'),
    gender: gv('empGenderFilter'),
    dept: gv('empDeptFilter'),
    edu: gv('empEduFilter'),
    shift: gv('empShiftFilter'),
    skill: gv('empSkillFilter'),
    area: gv('empAreaFilter')
  };
}

function getPatientStatusMeta(patient) {
  var raw = (patient && patient.status ? String(patient.status) : 'Active').trim();
  var normalized = raw.toLowerCase();
  if (normalized === 'active') return { label:'Active', badge:'bdg-green', rowClass:'row-tint-green', priority:0 };
  if (normalized === 'paused') return { label:'Paused', badge:'bdg-amber', rowClass:'row-tint-amber', priority:1 };
  if (normalized === 'closed') return { label:'Closed', badge:'bdg-amber', rowClass:'row-tint-amber', priority:2 };
  if (normalized === 'discharged') return { label:'Discharged', badge:'bdg-amber', rowClass:'row-tint-amber', priority:3 };
  if (normalized === 'deceased') return { label:'Deceased', badge:'bdg-red', rowClass:'row-tint-red', priority:4 };
  return { label:capitalizeWords(raw), badge:'bdg-gray', rowClass:'', priority:5 };
}

function updateUploadProgress(targetId, message) {
  var el = document.getElementById(targetId);
  if (el) el.textContent = message || '';
}

function compressImageToData(file, maxWidth, quality) {
  return new Promise(function(resolve, reject){
    var reader = new FileReader();
    reader.onload = function(e) {
      var img = new Image();
      img.onload = function() {
        var width = img.width;
        var height = img.height;
        if (width > maxWidth) {
          height = Math.round(height * (maxWidth / width));
          width = maxWidth;
        }
        var canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(function(blob){
          if (!blob) {
            reject(new Error('Image compression failed'));
            return;
          }
          var fr = new FileReader();
          fr.onload = function(ev){
            resolve({
              type: 'image/jpeg',
              size: blob.size,
              data: ev.target.result
            });
          };
          fr.onerror = reject;
          fr.readAsDataURL(blob);
        }, 'image/jpeg', quality);
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function fileToData(file) {
  return new Promise(function(resolve, reject){
    var reader = new FileReader();
    reader.onload = function(e) { resolve(e.target.result); };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function getSettingsSignatureHtml() {
  ensureExtraState();
  var img = DB.settings.signature ? '<img src="' + DB.settings.signature + '" style="max-height:58px;max-width:180px;display:block;margin:0 auto 6px;">' : '<div style="height:38px"></div>';
  var seal = DB.settings.seal ? '<img src="' + DB.settings.seal + '" style="max-height:50px;max-width:90px;display:block;margin:0 auto 6px;">' : '<div style="height:32px"></div>';
  return '<div style="display:flex;justify-content:space-between;gap:16px;align-items:flex-end;margin-top:28px;">'
    + '<div style="text-align:center;flex:1;">' + img + '<div style="border-top:1px solid #1a3a5c;padding-top:6px;font-size:12px;font-weight:700;">' + safeText(DB.settings.signatoryTitle || 'Authorised Signatory') + '</div></div>'
    + '<div style="text-align:center;width:110px;">' + seal + '<div style="font-size:11px;color:#64748b;">Company Seal</div></div>'
    + '</div>';
}

function buildPdfShell(title, subtitle, innerHtml, stampText, watermark) {
  var header = ''
    + '<div style="display:flex;align-items:center;gap:14px;border-bottom:3px solid #1a3a5c;padding-bottom:14px;margin-bottom:18px;">'
    + '<img src="' + getLogoSrc() + '" style="height:64px;width:64px;object-fit:contain;">'
    + '<div style="flex:1;">'
    + '<div style="font-size:24px;font-weight:900;color:#1a3a5c;">' + COMPANY.name + '</div>'
    + '<div style="font-size:13px;color:#1565c0;font-weight:700;margin-top:2px;">' + COMPANY.tagline + '</div>'
    + '<div style="font-size:12px;color:#475569;margin-top:4px;">' + COMPANY.address + '</div>'
    + '<div style="font-size:12px;color:#475569;">Phone: ' + COMPANY.phone + ' | Email: ' + COMPANY.email + '</div>'
    + '</div>'
    + '</div>';
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>' + safeText(title) + '</title>'
    + '<style>'
    + 'body{font-family:Arial,sans-serif;background:#eef3ff;margin:0;color:#0f172a;}'
    + '.page{max-width:900px;margin:20px auto;background:#fff;padding:30px;border-radius:14px;position:relative;overflow:hidden;}'
    + '.wm{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:72px;font-weight:900;color:rgba(21,101,192,.07);transform:rotate(-30deg);pointer-events:none;}'
    + 'h1{font-size:20px;color:#1a3a5c;margin:0 0 6px;}'
    + '.subtitle{font-size:12px;color:#64748b;margin-bottom:18px;}'
    + 'table{width:100%;border-collapse:collapse;font-size:12px;margin-top:12px;}'
    + 'th{background:#1a3a5c;color:#fff;padding:8px;border:1px solid #dbe3f0;text-align:left;}'
    + 'td{padding:8px;border:1px solid #dbe3f0;vertical-align:top;}'
    + '.meta{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:12px;}'
    + '.box{background:#f8fbff;border:1px solid #dbeafe;border-radius:10px;padding:12px;}'
    + '.k{font-size:10px;text-transform:uppercase;font-weight:800;color:#64748b;margin-bottom:4px;}'
    + '.v{font-size:13px;color:#0f172a;}'
    + '.footer{margin-top:16px;padding-top:12px;border-top:1px solid #dbe3f0;font-size:11px;color:#475569;}'
    + '.stamp{margin-top:10px;font-size:12px;font-weight:700;color:#1a3a5c;background:#eff6ff;border:1px solid #bfdbfe;padding:8px 10px;border-radius:8px;}'
    + '.bar-chart{display:flex;align-items:flex-end;gap:10px;height:220px;padding:12px 0 0;}'
    + '.bar{flex:1;background:linear-gradient(180deg,#60a5fa,#1565c0);border-radius:8px 8px 0 0;position:relative;min-width:48px;}'
    + '.bar-label{position:absolute;bottom:-22px;left:0;right:0;text-align:center;font-size:10px;color:#64748b;}'
    + '.bar-value{position:absolute;top:-18px;left:0;right:0;text-align:center;font-size:10px;font-weight:700;color:#1a3a5c;}'
    + '@media print{body{background:#fff;} .page{margin:0 auto;border-radius:0;box-shadow:none;} }'
    + '</style></head><body><div class="page">'
    + (watermark ? '<div class="wm">' + safeText(watermark) + '</div>' : '')
    + header
    + '<h1>' + safeText(title) + '</h1>'
    + '<div class="subtitle">' + safeText(subtitle || '') + '</div>'
    + innerHtml
    + '<div class="stamp">' + safeText(stampText || buildStampText('Generated')) + '</div>'
    + getSettingsSignatureHtml()
    + '<div class="footer">Generated by Hominal Healthcare CRM | ' + COMPANY.site + '</div>'
    + '</div><script>window.onload=function(){setTimeout(function(){window.print();},300);};<\/script></body></html>';
}

function openPrintWindow(title, subtitle, bodyHtml, stampText, watermark) {
  var win = window.open('', '_blank');
  if (!win) {
    toast('Please allow popups to print PDF views','error');
    return;
  }
  win.document.open();
  win.document.write(buildPdfShell(title, subtitle, bodyHtml, stampText, watermark));
  win.document.close();
}

function getMonthLabel(dateValue) {
  var dt = parseAppDate(dateValue || todayIso());
  if (!dt) dt = new Date();
  return dt.toLocaleString('en-IN', { month:'long', year:'numeric' });
}

function getDateRange() {
  var mode = gv('reportRangeMode') || 'monthly';
  var from = gv('reportFrom');
  var to = gv('reportTo');
  var now = new Date();
  var start;
  var end;
  if (mode === 'yearly') {
    start = new Date(now.getFullYear(), 0, 1);
    end = new Date(now.getFullYear(), 11, 31);
  } else if (mode === 'custom' && from && to) {
    start = parseAppDate(from);
    end = parseAppDate(to);
  } else {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
    end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  }
  return { mode:mode, from:dateToIso(start), to:dateToIso(end) };
}

function dateWithinRange(dateValue, range) {
  var date = parseAppDate(dateValue);
  if (!date) return false;
  var from = parseAppDate(range.from);
  var to = parseAppDate(range.to);
  if (!from || !to) return true;
  return date >= from && date <= new Date(to.getTime() + 86399999);
}

function getMonthlyBuckets(mapper) {
  var order = [];
  var bucketMap = {};
  mapper.forEach(function(row){
    var label = row.label;
    if (!bucketMap[label]) {
      bucketMap[label] = 0;
      order.push(label);
    }
    bucketMap[label] += row.value;
  });
  return order.map(function(label){
    return { label:label, value:bucketMap[label] };
  });
}

function ensureSettingsAndReportsDom() {
  var navScroll = document.querySelector('.nav-scroll');
  if (navScroll && !document.querySelector('.nav-btn[data-page="reports"]')) {
    var reportsBtn = document.createElement('button');
    reportsBtn.className = 'nav-btn';
    reportsBtn.setAttribute('data-page', 'reports');
    reportsBtn.textContent = '📊 Reports';
    navScroll.appendChild(reportsBtn);
    reportsBtn.addEventListener('click', function(){ nav('reports'); });
  }
  var adminDd = document.getElementById('adminDD');
  if (adminDd && !document.getElementById('adminSettingsBtn')) {
    var settingsItem = document.createElement('div');
    settingsItem.className = 'admin-dd-item';
    settingsItem.id = 'adminSettingsBtn';
    settingsItem.textContent = '⚙ Settings';
    adminDd.insertBefore(settingsItem, adminDd.firstChild);
    settingsItem.addEventListener('click', function(){
      nav('settings');
      toggleAdminDD();
    });
  }
  var content = document.getElementById('mainContent');
  if (content && !document.getElementById('page-reports')) {
    var reportsPage = document.createElement('div');
    reportsPage.className = 'page';
    reportsPage.id = 'page-reports';
    reportsPage.innerHTML = ''
      + '<div class="pg-hdr"><div><div class="pg-label">Analytics</div><div class="pg-title">Reports</div></div>'
      + '<div class="pg-acts"><button class="btn btn-ghost btn-sm" id="reportExportBtn">📤 Export CSV</button><button class="btn btn-primary btn-sm" id="reportPrintBtn">📄 Print Report</button></div></div>'
      + '<div class="filter-bar">'
      + '<select id="reportRangeMode"><option value="monthly">Monthly</option><option value="yearly">Yearly</option><option value="custom">Custom Range</option></select>'
      + '<input id="reportFrom" type="date">'
      + '<input id="reportTo" type="date">'
      + '<select id="reportType"><option value="patient-billing">Patient Billing Report</option><option value="employee-payout">Employee Payout Report</option><option value="profit-loss">Profit & Loss Statement</option><option value="inquiry-conversion">Inquiry Conversion Report</option><option value="attendance-service">Attendance & Service Report</option></select>'
      + '<button class="btn btn-outline btn-sm" id="reportApplyBtn">Apply</button>'
      + '</div>'
      + '<div class="card"><div class="card-hdr"><span class="card-title" id="reportTitle">Patient Billing Report</span></div><div class="card-body" id="reportBody"></div></div>';
    content.appendChild(reportsPage);
  }
  if (content && !document.getElementById('page-settings')) {
    var settingsPage = document.createElement('div');
    settingsPage.className = 'page';
    settingsPage.id = 'page-settings';
    settingsPage.innerHTML = ''
      + '<div class="pg-hdr"><div><div class="pg-label">Configuration</div><div class="pg-title">Settings</div></div><div class="pg-acts"><button class="btn btn-primary btn-sm" id="saveSettingsBtn">💾 Save Settings</button></div></div>'
      + '<div class="card"><div class="card-hdr"><span class="card-title">PDF Signatory</span></div><div class="card-body">'
      + '<div class="fr c2"><div class="fg"><label>Signatory Label</label><input id="settingSignatoryName" placeholder="Authorised Signatory"></div><div class="fg"><label>Signatory Title</label><input id="settingSignatoryTitle" placeholder="Authorised Signatory"></div></div>'
      + '<div class="fr c2 mt8"><div class="fg"><label>Signature Image</label><label class="upload-plus">+ Upload Signature<input id="settingSignatureInput" type="file" accept="image/*"></label><div id="signaturePreview" class="media-preview"><div class="sm">No signature uploaded.</div></div></div>'
      + '<div class="fg"><label>Company Seal Image</label><label class="upload-plus">+ Upload Seal<input id="settingSealInput" type="file" accept="image/*"></label><div id="sealPreview" class="media-preview"><div class="sm">No seal uploaded.</div></div></div></div>'
      + '</div></div>';
    content.appendChild(settingsPage);
  }
  if (!document.getElementById('inqShareModal')) {
    var shareModal = document.createElement('div');
    shareModal.className = 'modal-bg';
    shareModal.id = 'inqShareModal';
    shareModal.innerHTML = ''
      + '<div class="modal-box mmd">'
      + '<div class="modal-hdr"><h3>Send Inquiry To Staff</h3><button class="modal-close" type="button">✕</button></div>'
      + '<div class="card-body">'
      + '<div class="sm" style="margin-bottom:10px">Select a nurse or attendant to share this inquiry on WhatsApp.</div>'
      + '<div class="tbl-wrap" style="max-height:320px;overflow:auto"><table><thead><tr><th></th><th>ID</th><th>Name</th><th>Type</th><th>WhatsApp</th></tr></thead><tbody id="inqShareBody"></tbody></table></div>'
      + '</div>'
      + '<div class="modal-footer"><button class="btn btn-ghost btn-sm" id="inqShareCancelBtn" type="button">Cancel</button><button class="btn btn-success btn-sm" id="inqShareSendBtn" type="button">📤 Send to Staff</button></div></div>';
    document.body.appendChild(shareModal);
  }
}

function renderMediaPreview(targetId, dataUri, fileName, sizeLabel) {
  var target = document.getElementById(targetId);
  if (!target) return;
  if (!dataUri) {
    target.innerHTML = '<div class="sm">No file uploaded.</div>';
    return;
  }
  target.innerHTML = '<div class="media-thumb-wrap"><img class="media-thumb" src="' + dataUri + '" alt=""><div class="media-thumb-meta"><div class="doc-name">' + safeText(fileName || 'image.jpg') + '</div><div class="doc-sub">' + safeText(sizeLabel || '') + '</div></div></div>';
}

function renderSettingsPreview() {
  ensureExtraState();
  renderMediaPreview('signaturePreview', DB.settings.signature, 'signature.jpg', DB.settings.signature ? 'Ready' : '');
  renderMediaPreview('sealPreview', DB.settings.seal, 'seal.jpg', DB.settings.seal ? 'Ready' : '');
  sv('settingSignatoryName', DB.settings.signatoryName || 'Authorised Signatory');
  sv('settingSignatoryTitle', DB.settings.signatoryTitle || 'Authorised Signatory');
}

function patchEmployeeUi() {
  var desigInput = document.getElementById('ef_desig');
  if (desigInput && desigInput.tagName === 'INPUT') {
    var select = document.createElement('select');
    select.id = 'ef_desig';
    setOptions(select, DESIGNATION_OPTIONS, 'Select');
    desigInput.parentNode.replaceChild(select, desigInput);
  }
  var typeSelect = document.getElementById('ef_etype');
  setOptions(typeSelect, EMPLOYEE_TYPES, 'Select');
  var eduSelect = document.getElementById('ef_edu');
  setOptions(eduSelect, EDUCATION_OPTIONS, 'Select');
  var shiftSelect = document.getElementById('eShift');
  setOptions(shiftSelect, SHIFT_OPTIONS, null);
  var skillSelect = document.getElementById('ef_skills');
  setOptions(skillSelect, getEmployeeProfileOptions(), 'Select');
  EMP_AREA_LIST = getAreaOptions();
  ensureDatalist('ef_area', 'employeeAreaOptions', EMP_AREA_LIST);
  var docInput = document.getElementById('ef_docs');
  if (docInput && !document.getElementById('empDocType')) {
    var wrapper = docInput.parentNode;
    clearElement(wrapper);
    wrapper.appendChild(createTextNodeEl('label', 'Upload Documents', ''));
    var row = document.createElement('div');
    row.className = 'fr c2 mt8';
    var typeFg = document.createElement('div');
    typeFg.className = 'fg';
    var typeLabel = createTextNodeEl('label', 'Document Type', '');
    var typeSelectEl = document.createElement('select');
    typeSelectEl.id = 'empDocType';
    setOptions(typeSelectEl, EMPLOYEE_DOC_TYPES, 'Select');
    typeFg.appendChild(typeLabel);
    typeFg.appendChild(typeSelectEl);
    var uploadFg = document.createElement('div');
    uploadFg.className = 'fg';
    var uploadLabel = createTextNodeEl('label', 'Upload Files', '');
    var plusLabel = document.createElement('label');
    plusLabel.className = 'upload-plus';
    plusLabel.textContent = '+ Add Documents';
    docInput.style.display = 'none';
    plusLabel.appendChild(docInput);
    uploadFg.appendChild(uploadLabel);
    uploadFg.appendChild(plusLabel);
    row.appendChild(typeFg);
    row.appendChild(uploadFg);
    wrapper.appendChild(row);
    var progress = createTextNodeEl('div', '', 'sm mt8');
    progress.id = 'empDocProgress';
    wrapper.appendChild(progress);
  }
  var docTitle = document.querySelector('#empModal .fsec:nth-last-of-type(1) .fsec-title');
  if (docTitle) docTitle.textContent = 'Documents';
  var scoreSection = document.getElementById('employeeScoreSection');
  if (!scoreSection) {
    var modal = document.getElementById('empModal');
    var footer = modal ? modal.querySelector('.modal-footer') : null;
    if (footer) {
      scoreSection = document.createElement('div');
      scoreSection.id = 'employeeScoreSection';
      scoreSection.className = 'fsec';
      scoreSection.innerHTML = ''
        + '<div class="fsec-title">Employee Scores (Out of 10)</div>'
        + '<div class="fr c3">'
        + '<div class="fg"><label>Experience <strong id="ef_score_exp_val" style="color:#1565c0">5</strong>/10</label><input id="ef_score_exp" type="range" min="1" max="10" value="5"></div>'
        + '<div class="fg"><label>Behaviour <strong id="ef_score_beh_val" style="color:#16a34a">5</strong>/10</label><input id="ef_score_beh" type="range" min="1" max="10" value="5"></div>'
        + '<div class="fg"><label>Testimonial <strong id="ef_score_tes_val" style="color:#dc2626">5</strong>/10</label><input id="ef_score_tes" type="range" min="1" max="10" value="5"></div>'
        + '</div><div class="sm mt8" id="ef_score_total">Overall Score: 5.0 / 10</div>';
      footer.parentNode.insertBefore(scoreSection, footer);
    }
  }
  var empFilterBar = document.querySelector('#page-employees .filter-bar');
  if (empFilterBar && !document.getElementById('empEduFilter')) {
    var eduFilter = document.createElement('select');
    eduFilter.id = 'empEduFilter';
    setOptions(eduFilter, EDUCATION_OPTIONS, 'All Education');
    var shiftFilter = document.createElement('select');
    shiftFilter.id = 'empShiftFilter';
    setOptions(shiftFilter, SHIFT_OPTIONS, 'All Shift');
    empFilterBar.insertBefore(eduFilter, document.getElementById('empSkillFilter'));
    empFilterBar.insertBefore(shiftFilter, document.getElementById('empSkillFilter'));
  }
}

function patchPatientUi() {
  setOptions(document.getElementById('pf_status'), PATIENT_STATUSES, null);
  setOptions(document.getElementById('patStatusFilter'), PATIENT_STATUSES, 'All Status');
  ensureDatalist('pf_area', 'patientAreaOptions', getAreaOptions());
  var closeModal = document.getElementById('closeBillModal');
  if (closeModal && !document.getElementById('closeReason')) {
    var box = closeModal.querySelector('.confirm-box');
    var p = box.querySelector('p');
    if (p) p.textContent = 'Select a closing reason to proceed.';
    var wrap = document.createElement('div');
    wrap.className = 'fr c1';
    wrap.style.textAlign = 'left';
    wrap.style.marginBottom = '16px';
    wrap.innerHTML = ''
      + '<div class="fg"><label>Reason *</label><select id="closeReason"></select></div>'
      + '<div class="fg mt8" id="closeReasonOtherWrap" style="display:none"><label>Other Reason *</label><input id="closeReasonOther" type="text" placeholder="Enter reason"></div>';
    box.insertBefore(wrap, box.querySelector('.confirm-acts'));
    setOptions(document.getElementById('closeReason'), BILL_CLOSE_REASONS, 'Select');
  }
  var pauseModal = document.getElementById('pauseBillModal');
  if (pauseModal && !document.getElementById('pauseReason')) {
    var pauseBox = pauseModal.querySelector('.confirm-box');
    var pauseWrap = document.createElement('div');
    pauseWrap.className = 'fr c1';
    pauseWrap.style.textAlign = 'left';
    pauseWrap.style.marginBottom = '16px';
    pauseWrap.innerHTML = '<div class="fg"><label>Pause Reason</label><input id="pauseReason" type="text" placeholder="Reason for pausing"></div>';
    pauseBox.insertBefore(pauseWrap, pauseBox.querySelector('.confirm-acts'));
  }
}

function patchInquiryUi() {
  setOptions(document.getElementById('iq_source'), INQUIRY_SOURCES, 'Select');
  setOptions(document.getElementById('inqSourceFilter'), INQUIRY_SOURCES, 'All Sources');
  var pageHdr = document.querySelector('#page-inquiries .pg-acts');
  if (pageHdr && !document.getElementById('inqPdfInfo')) {
    var note = createTextNodeEl('div', 'PDF A = with phone | PDF B = without phone', 'sm');
    note.id = 'inqPdfInfo';
    pageHdr.insertBefore(note, pageHdr.firstChild);
  }
}

function patchBillingUi() {
  var svcGrid = document.querySelector('#page-service-detail .card.card-body > div[style*="grid-template-columns"]');
  if (svcGrid && !document.getElementById('svcAbsent')) {
    svcGrid.style.gridTemplateColumns = '130px 150px 90px 70px 90px 90px 100px 1fr';
    var absentFg = document.createElement('div');
    absentFg.className = 'fg';
    absentFg.innerHTML = '<label>Absent Days</label><input type="number" id="svcAbsent" value="0" min="0">';
    svcGrid.insertBefore(absentFg, document.getElementById('svcTotalField').parentNode);
  }
  var billHdrActs = document.querySelector('#page-billing-detail .pg-acts');
  if (billHdrActs && !document.getElementById('billWaBtn')) {
    var waBtn = createButton('💬 Bill WA', 'btn btn-success btn-sm', function(){
      var pat = DB.patients.find(function(row){ return row.id === currentBillingPatId; });
      if (!pat) return;
      var money = getBillingFinancials(currentBillingPatId);
      var msg = 'Bill update for ' + pat.name + ': Total ' + formatCurrency(money.total) + ', Outstanding ' + formatCurrency(money.outstanding) + '. — ' + COMPANY.brand + ' | ' + COMPANY.phone;
      window.open(waLink(pat.phone, msg), '_blank');
    });
    waBtn.id = 'billWaBtn';
    billHdrActs.insertBefore(waBtn, billHdrActs.firstChild);
  }
}

function patchPayoutUi() {
  var payBox = document.querySelector('#payModal .confirm-box');
  if (payBox && !document.getElementById('payProofInput')) {
    var wrap = document.createElement('div');
    wrap.className = 'fr c1';
    wrap.style.textAlign = 'left';
    wrap.style.marginBottom = '16px';
    wrap.innerHTML = '<div class="fg"><label>Payment Photo / Screenshot</label><label class="upload-plus">+ Upload Proof<input id="payProofInput" type="file" accept="image/*,.pdf,application/pdf" style="display:none"></label><div id="payProofMeta" class="sm mt8">No proof uploaded.</div></div>';
    payBox.insertBefore(wrap, payBox.querySelector('.confirm-acts'));
  }
}

function patchStaticIds() {
  var buttons = document.querySelectorAll('.modal-close');
  buttons.forEach(function(btn){
    btn.addEventListener('click', function(){
      var modal = btn.closest('.modal-bg');
      if (modal) closeModal(modal.id);
    });
  });
  var setId = function(selector, id, index) {
    var list = document.querySelectorAll(selector);
    var el = typeof index === 'number' ? list[index] : document.querySelector(selector);
    if (el) el.id = id;
  };
  setId('.pass-toggle', 'loginPassToggle');
  setId('.logo-area', 'topLogoArea');
  setId('.admin-btn', 'adminToggleBtn');
  setId('#adminDD .admin-dd-item:last-child', 'logoutMenuBtn');
  setId('#page-dashboard .card-hdr .btn', 'dashPatientsBtn', 0);
  setId('#page-dashboard .card-hdr .btn', 'dashPayoutBtn', 1);
  setId('#page-users .pg-acts .btn', 'userCreateBtn');
  setId('#page-roles .pg-acts .btn', 'roleCreateBtn');
  setId('#page-employees .pg-acts .btn', 'empExportBtn', 0);
  setId('#page-employees .pg-acts .btn', 'empPdfBtn', 1);
  setId('#page-employees .pg-acts .btn', 'empCreateBtn', 2);
  setId('#page-doctors .pg-acts .btn', 'docExportBtn', 0);
  setId('#page-doctors .pg-acts .btn', 'docCreateBtn', 1);
  setId('#page-vendors .pg-acts .btn', 'vendExportBtn', 0);
  setId('#page-vendors .pg-acts .btn', 'vendCreateBtn', 1);
  setId('#page-patients .pg-acts .btn', 'patExportBtn', 0);
  setId('#page-patients .pg-acts .btn', 'patCreateBtn', 1);
  setId('#page-inquiries .pg-acts .btn', 'inqExportBtn', 0);
  setId('#page-inquiries .pg-acts .btn', 'inqCreateBtn', 1);
  setId('#page-billings .pg-acts .btn', 'billExportBtn');
  setId('#page-billing-detail .pg-acts .btn', 'billProvBtn', 0);
  setId('#page-billing-detail .pg-acts .btn', 'billPdfBtn', 1);
  setId('#page-billing-detail .pg-acts .btn', 'billCloseBtn', 2);
  setId('#page-billing-detail .pg-acts .btn', 'billPauseBtn', 3);
  setId('#page-billing-detail .pg-acts .btn', 'billReceiptNavBtn', 4);
  setId('#page-billing-detail .pg-acts .btn', 'billBackBtn', 5);
  setId('#page-billing-detail .card-hdr .btn', 'bdAddReceiptBtn');
  setId('#page-service-detail .card.card-body .btn', 'svcAssignBtn', 0);
  setId('#page-billing-receipt .pg-acts .btn', 'receiptPdfBtn', 0);
  setId('#page-billing-receipt .pg-acts .btn', 'receiptBackBtn');
  setId('#page-billing-receipt .card.card-body .btn', 'receiptAddBtn');
  setId('#page-payout .pg-acts .btn', 'paidTxNavBtn');
  setId('#page-paid-transactions .pg-acts .btn', 'paidBackBtn');
  setId('#page-payout-charges .card.card-body .btn', 'payoutChargeAddBtn');
  setId('#page-bill-print .pg-acts .btn', 'billPrintPdfBtn', 0);
  setId('#page-bill-print .pg-acts .btn', 'billPrintBtn', 1);
}

function bindStaticActions() {
  var bind = function(id, handler) {
    var el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('click', handler);
  };
  var bindChange = function(id, handler) {
    var el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', handler);
  };
  var bindInput = function(id, handler) {
    var el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', handler);
  };
  bind('loginPassToggle', togglePassVis);
  bind('loginBtn', doLogin);
  bind('topLogoArea', function(){ nav('dashboard'); });
  bind('adminToggleBtn', function(e){ e.stopPropagation(); toggleAdminDD(); });
  bind('logoutMenuBtn', doLogout);
  bind('retryBtn', retryConnection);
  bind('dashPatientsBtn', function(){ nav('patients'); });
  bind('dashPayoutBtn', function(){ nav('payout'); });
  bind('userCreateBtn', function(){ setUserMode('create'); openModal('userModal'); });
  bindInput('userSearch', renderUsers);
  bind('roleCreateBtn', function(){ editingRole = null; sv('roleName', ''); buildPermSections({}); openModal('roleModal'); });
  bindInput('roleSearch', renderRoles);
  bind('empExportBtn', function(){ exportCSV('employees'); });
  bind('empPdfBtn', downloadEmployeesPdf);
  bind('empCreateBtn', function(){ setEmpMode('create'); openModal('empModal'); });
  ['empTypeFilter','empGenderFilter','empDeptFilter','empEduFilter','empShiftFilter'].forEach(function(id){ bindChange(id, renderEmployees); });
  ['empSkillFilter','empAreaFilter','empSearch'].forEach(function(id){ bindInput(id, renderEmployees); });
  bind('docExportBtn', function(){ exportCSV('doctors'); });
  bind('docCreateBtn', function(){ setDocMode('create'); openModal('docModal'); });
  bindInput('docSearch', renderDoctors);
  bind('vendExportBtn', function(){ exportCSV('vendors'); });
  bind('vendCreateBtn', function(){ setVendMode('create'); openModal('vendModal'); });
  bindInput('vendSearch', renderVendors);
  bind('patExportBtn', function(){ exportCSV('patients'); });
  bind('patCreateBtn', function(){ setPatMode('create'); openModal('patModal'); });
  ['patStatusFilter','patGenderFilter'].forEach(function(id){ bindChange(id, renderPatients); });
  ['patAreaFilter','patPinFilter','patSearch'].forEach(function(id){ bindInput(id, renderPatients); });
  bind('inqExportBtn', function(){ exportCSV('inquiries'); });
  bind('inqCreateBtn', function(){ setInqMode('create'); openModal('inqModal'); });
  ['inqStatusFilter','inqSourceFilter','inqPotentialFilter'].forEach(function(id){ bindChange(id, renderInquiries); });
  bindInput('inqSearch', renderInquiries);
  bindInput('billSearch', renderBillingsList);
  bindChange('billStatusFilter', renderBillingsList);
  bind('billExportBtn', function(){ exportCSV('billings'); });
  bind('billProvBtn', openProvBill);
  bind('billPdfBtn', function(){ downloadBillPdf(currentBillingPatId); });
  bind('billCloseBtn', function(){ openModal('closeBillModal'); });
  bind('billPauseBtn', function(){ openModal('pauseBillModal'); });
  bind('billReceiptNavBtn', navToReceipts);
  bind('billBackBtn', function(){ nav('billings'); });
  bind('bdAddReceiptBtn', navToReceipts);
  bind('svcAssignBtn', openPartnerPicker);
  bindInput('svcAmt', calcSvcTotal);
  bindInput('svcCount', calcSvcTotal);
  bindInput('svcDisc', calcSvcTotal);
  bindInput('svcAbsent', calcSvcTotal);
  bind('svcSaveBtn', addSvcEntry);
  bind('receiptPdfBtn', function(){ downloadReceiptsPdf(currentBillingPatId); });
  bind('receiptAddBtn', addReceipt);
  bind('paidTxNavBtn', function(){ nav('paid-transactions'); });
  bind('paidBackBtn', function(){ nav('payout'); });
  bind('payoutChargeAddBtn', addPayoutCharge);
  bind('billPrintPdfBtn', function(){ downloadBillPdf(currentBillingPatId); });
  bind('billPrintBtn', function(){ window.print(); });
  document.querySelectorAll('.modal-footer .btn-ghost, .confirm-acts .btn-ghost').forEach(function(btn){
    if (btn.id === 'provBillModalSaveBtn') return;
    btn.addEventListener('click', function(){
      var modal = btn.closest('.modal-bg');
      if (modal) closeModal(modal.id);
    });
  });
  bind('userSaveBtn', saveUser);
  bind('roleSaveBtn', saveRole);
  bind('empSaveBtn', saveEmployee);
  bind('docSaveBtn', saveDoctor);
  bind('vendSaveBtn', saveVendor);
  bind('patSaveBtn', savePatient);
  var inqSaveBtn = document.querySelector('#inqModal .btn-success');
  if (inqSaveBtn) inqSaveBtn.addEventListener('click', saveInquiry);
  bind('inqShareCancelBtn', function(){ closeModal('inqShareModal'); });
  bind('inqShareSendBtn', sendInquiryToSelectedStaff);
  bindChange('ef_docs', function(){ handleEmpDocUpload(this); });
  bindChange('pf_photo_input', function(){ handlePatientPhotoUpload(this); });
  bindChange('pf_docs', function(){ handlePatientDocUpload(this); });
  bindInput('pf_pin', function(){ handlePatientPinChange(false); });
  ['iq_r1','iq_r2','iq_r3'].forEach(function(id, idx){
    var outIds = ['iq_r1_val','iq_r2_val','iq_r3_val'];
    bindInput(id, function(){ setSliderOutput(id, outIds[idx]); });
  });
  ['ef_score_exp','ef_score_beh','ef_score_tes'].forEach(function(id, idx){
    var outIds = ['ef_score_exp_val','ef_score_beh_val','ef_score_tes_val'];
    bindInput(id, function(){ updateEmployeeScoreDisplay(); setSliderOutput(id, outIds[idx]); });
  });
  bindChange('closeReason', toggleCloseReasonOther);
  bind('saveSettingsBtn', saveSettingsPage);
  bindChange('settingSignatureInput', function(){ handleSettingsImageUpload(this, 'signature'); });
  bindChange('settingSealInput', function(){ handleSettingsImageUpload(this, 'seal'); });
  bind('reportApplyBtn', renderReports);
  bind('reportExportBtn', exportReportCsv);
  bind('reportPrintBtn', printCurrentReport);
  bindChange('reportRangeMode', toggleReportRangeInputs);
  bindChange('reportType', renderReports);
  bind('startModalConfirmBtn', doStart);
  bind('closeBillConfirmBtn', doCloseBill);
  bind('pauseBillConfirmBtn', doPauseBill);
  bind('payConfirmBtn', doPayPartner);
  bind('partnerConfirmBtn', confirmPartnerPick);
  bindChange('payProofInput', function(){ handlePaymentProofUpload(this); });
  bindInput('partnerSearch', renderPartnerPicker);
  bindChange('payMethod', updatePayProofLabel);
  var importMap = {
    employees: 'employees',
    doctors: 'doctors',
    vendors: 'vendors',
    patients: 'patients',
    inquiries: 'inquiries'
  };
  Object.keys(importMap).forEach(function(pageName){
    var input = document.querySelector('#page-' + pageName + ' input[type="file"][accept=".csv"]');
    if (input) {
      input.addEventListener('change', function(){ importCSV(importMap[pageName], this); });
    }
  });
}

function decorateConfirmButtons() {
  var setBtn = function(modalId, position, id) {
    var modal = document.getElementById(modalId);
    if (!modal) return;
    var buttons = modal.querySelectorAll('.confirm-acts .btn');
    if (buttons[position]) buttons[position].id = id;
  };
  setBtn('startModal', 1, 'startModalConfirmBtn');
  setBtn('closeBillModal', 1, 'closeBillConfirmBtn');
  setBtn('pauseBillModal', 1, 'pauseBillConfirmBtn');
  setBtn('payModal', 1, 'payConfirmBtn');
  var partnerModal = document.getElementById('partnerModal');
  if (partnerModal) {
    var partnerBtns = partnerModal.querySelectorAll('.modal-footer .btn');
    if (partnerBtns[1]) partnerBtns[1].id = 'partnerConfirmBtn';
  }
}

function toggleCloseReasonOther() {
  var wrap = document.getElementById('closeReasonOtherWrap');
  if (!wrap) return;
  wrap.style.display = gv('closeReason') === 'Other' ? 'block' : 'none';
}

function updateEmployeeScoreDisplay() {
  var score = calculateEmployeeScore({
    scoreExperience: gv('ef_score_exp'),
    scoreBehaviour: gv('ef_score_beh'),
    scoreTestimonial: gv('ef_score_tes')
  });
  setEl('ef_score_total', 'Overall Score: ' + score + ' / 10');
}

async function handleSettingsImageUpload(input, key) {
  var file = input && input.files && input.files[0];
  if (!file) return;
  try {
    var payload = await compressImageToData(file, 400, 0.7);
    DB.settings[key] = payload.data;
    renderSettingsPreview();
    saveDB();
  } catch (err) {
    toast('Unable to process image','error');
  }
  input.value = '';
}

async function handlePaymentProofUpload(input) {
  var file = input && input.files && input.files[0];
  if (!file) return;
  try {
    if ((file.type || '').indexOf('image/') === 0) {
      var image = await compressImageToData(file, 400, 0.7);
      pendingPaymentProof = image.data;
      updateUploadProgress('payProofMeta', file.name + ' uploaded');
    } else {
      pendingPaymentProof = await fileToData(file);
      updateUploadProgress('payProofMeta', file.name + ' uploaded');
    }
  } catch (err) {
    toast('Unable to read proof file','error');
  }
  input.value = '';
}

function updatePayProofLabel() {
  var method = gv('payMethod');
  var label = document.querySelector('#payModal label[for="payProofInput"]');
  if (method === 'Cash') updateUploadProgress('payProofMeta', 'Cash payment requires signed receipt photo.');
  else updateUploadProgress('payProofMeta', pendingPaymentProof ? 'Proof uploaded' : 'Optional for UPI / Bank.');
}

async function prepareEmployeeDoc(file, category) {
  var lower = (file.name || '').toLowerCase();
  var docId = 'DOC' + Date.now() + Math.floor(Math.random() * 10000);
  if ((file.type || '').indexOf('image/') === 0) {
    var compressed = await compressImageToData(file, 400, 0.7);
    return {
      id: docId,
      name: lower.replace(/\.[^.]+$/, '') + '.jpg',
      type: 'image/jpeg',
      size: compressed.size,
      data: compressed.data,
      category: category || 'Any Other Document'
    };
  }
  if (file.type === 'application/pdf' || /\.pdf$/.test(lower)) {
    return {
      id: docId,
      name: file.name,
      type: 'application/pdf',
      size: file.size,
      data: await fileToData(file),
      category: category || 'Any Other Document'
    };
  }
  return null;
}

async function preparePatientPhoto(file) {
  var compressed = await compressImageToData(file, 400, 0.7);
  return {
    id: 'PPH' + Date.now() + Math.floor(Math.random() * 1000),
    name: slugText((file.name || 'patient').replace(/\.[^.]+$/, '')) + '.jpg',
    type: 'image/jpeg',
    size: compressed.size,
    data: compressed.data
  };
}

async function handleEmpDocUpload(input) {
  var files = Array.prototype.slice.call((input && input.files) || []);
  var category = gv('empDocType');
  if (!category) {
    toast('Select document type first','error');
    input.value = '';
    return;
  }
  if (!files.length) return;
  updateUploadProgress('empDocProgress', 'Uploading ' + files.length + ' file(s)...');
  var i;
  for (i = 0; i < files.length; i++) {
    var doc = await prepareEmployeeDoc(files[i], category);
    if (doc) empDocsBuffer.push(doc);
  }
  renderEmpDocList();
  updateUploadProgress('empDocProgress', files.map(function(file){ return file.name; }).join(', '));
  input.value = '';
}

function renderEmpDocList() {
  var box = document.getElementById('empDocList');
  clearElement(box);
  if (!box) return;
  if (!empDocsBuffer.length) {
    box.appendChild(createTextNodeEl('div', 'No documents uploaded yet.', 'sm'));
    return;
  }
  empDocsBuffer.forEach(function(doc){
    var item = createTextNodeEl('div', '', 'doc-item');
    var meta = createTextNodeEl('div', '', 'doc-meta');
    meta.appendChild(createTextNodeEl('div', doc.name, 'doc-name'));
    meta.appendChild(createTextNodeEl('div', (doc.category || 'Document') + ' · ' + formatFileSize(doc.size || 0), 'doc-sub'));
    var actions = createTextNodeEl('div', '', 'doc-actions');
    actions.appendChild(createButton('Open', 'btn btn-ghost btn-xs', function(){ downloadEmployeeDoc(doc.id); }));
    actions.appendChild(createButton('Remove', 'btn btn-danger btn-xs', function(){ removeEmployeeDoc(doc.id); }));
    item.appendChild(meta);
    item.appendChild(actions);
    box.appendChild(item);
  });
}

function renderPatientPhotoPreview() {
  var box = document.getElementById('patPhotoPreview');
  clearElement(box);
  if (!box) return;
  if (!patPhotoBuffer || !patPhotoBuffer.data) {
    box.appendChild(createTextNodeEl('div', 'No patient photo uploaded.', 'sm'));
    return;
  }
  var wrap = createTextNodeEl('div', '', 'media-thumb-wrap');
  var img = document.createElement('img');
  img.className = 'media-thumb';
  img.src = patPhotoBuffer.data;
  img.alt = 'Patient photo';
  var meta = createTextNodeEl('div', '', 'media-thumb-meta');
  meta.appendChild(createTextNodeEl('div', patPhotoBuffer.name || 'patient-photo.jpg', 'doc-name'));
  meta.appendChild(createTextNodeEl('div', formatFileSize(patPhotoBuffer.size || 0), 'doc-sub'));
  var actions = createTextNodeEl('div', '', 'doc-actions');
  actions.appendChild(createButton('Open', 'btn btn-ghost btn-xs', downloadPatientPhoto));
  actions.appendChild(createButton('Remove', 'btn btn-danger btn-xs', removePatientPhoto));
  meta.appendChild(actions);
  wrap.appendChild(img);
  wrap.appendChild(meta);
  box.appendChild(wrap);
}

function renderPatientDocList() {
  var box = document.getElementById('patDocList');
  clearElement(box);
  if (!box) return;
  if (!patDocsBuffer.length) {
    box.appendChild(createTextNodeEl('div', 'No patient documents uploaded.', 'sm'));
    return;
  }
  patDocsBuffer.forEach(function(doc){
    var item = createTextNodeEl('div', '', 'doc-item');
    var meta = createTextNodeEl('div', '', 'doc-meta');
    meta.appendChild(createTextNodeEl('div', doc.name, 'doc-name'));
    meta.appendChild(createTextNodeEl('div', formatFileSize(doc.size || 0), 'doc-sub'));
    var actions = createTextNodeEl('div', '', 'doc-actions');
    actions.appendChild(createButton('Open', 'btn btn-ghost btn-xs', function(){ downloadPatientDoc(doc.id); }));
    actions.appendChild(createButton('Remove', 'btn btn-danger btn-xs', function(){ removePatientDoc(doc.id); }));
    item.appendChild(meta);
    item.appendChild(actions);
    box.appendChild(item);
  });
}

function saveSettingsPage() {
  ensureExtraState();
  DB.settings.signatoryName = gv('settingSignatoryName') || 'Authorised Signatory';
  DB.settings.signatoryTitle = gv('settingSignatoryTitle') || 'Authorised Signatory';
  saveDB();
  saveSettingsToSupabase();
  renderSettingsPreview();
  toast('Settings saved');
}

function buildInfoGrid(items) {
  var html = ['<div class="info-grid">'];
  items.forEach(function(item){
    html.push('<div class="info-box"><div class="info-k">' + safeText(item.key) + '</div><div class="info-v">' + safeText(item.value || '-') + '</div></div>');
  });
  html.push('</div>');
  return html.join('');
}

function getPatientLatestCloseAudit(patientId) {
  var closeAudit = getLatestAudit('billing', patientId, 'close');
  return closeAudit || getLatestAudit('patient', patientId, 'status');
}

function renderUsers() {
  var q = ((document.getElementById('userSearch') || {}).value || '').toLowerCase();
  var tb = document.getElementById('userBody');
  if (!tb) return;
  clearElement(tb);
  DB.users.filter(function(user){
    return !q || String(user.username || '').toLowerCase().indexOf(q) !== -1 || String(user.email || '').toLowerCase().indexOf(q) !== -1;
  }).forEach(function(user, idx){
    var tr = document.createElement('tr');
    tr.appendChild(createTd(idx + 1));
    tr.appendChild(createTd(user.username || '', 'td-name'));
    tr.appendChild(createTd(user.email || ''));
    tr.appendChild(createTd(user.phone || ''));
    tr.appendChild(createTd(createBadge(user.role || '', 'bg-blue')));
    tr.appendChild(createTd(createBadge(user.isActive === false ? 'Inactive' : 'Active', user.isActive === false ? 'bg-red' : 'bg-green')));
    tr.appendChild(createActionCell([
      createButton('Edit', 'btn btn-ghost btn-xs', function(){ editUser(user.id); }),
      createButton('Delete', 'btn btn-danger btn-xs', function(){ deleteUser(user.id); })
    ]));
    tb.appendChild(tr);
  });
  populateRoleSelect('uRole');
}

function renderRoles() {
  var q = ((document.getElementById('roleSearch') || {}).value || '').toLowerCase();
  var tb = document.getElementById('roleBody');
  if (!tb) return;
  clearElement(tb);
  DB.roles.filter(function(role){
    return !q || String(role.name || '').toLowerCase().indexOf(q) !== -1;
  }).forEach(function(role, idx){
    var tr = document.createElement('tr');
    tr.appendChild(createTd(idx + 1));
    tr.appendChild(createTd(role.name || '', 'td-name'));
    tr.appendChild(createTd(Object.keys(role.perms || {}).length + ' modules'));
    tr.appendChild(createActionCell([
      createButton('Edit', 'btn btn-ghost btn-xs', function(){ editRole(role.id); })
    ]));
    tb.appendChild(tr);
  });
}

function renderEmployees() {
  var q = ((document.getElementById('empSearch') || {}).value || '').toLowerCase();
  var filters = getEmployeeFilterValues();
  var tb = document.getElementById('empBody');
  if (!tb) return;
  var list = DB.employees.filter(function(emp){
    var name = getEmployeeName(emp).toLowerCase();
    return (!q || name.indexOf(q) !== -1 || String(emp.id || '').toLowerCase().indexOf(q) !== -1)
      && (!filters.type || (emp.emp_type || '') === filters.type)
      && (!filters.gender || (emp.gender || '') === filters.gender)
      && (!filters.dept || (emp.dept || '') === filters.dept)
      && (!filters.edu || (emp.edu || '') === filters.edu)
      && (!filters.shift || (emp.shift || '') === filters.shift)
      && (!filters.skill || String(emp.skills || '').toLowerCase().indexOf(String(filters.skill).toLowerCase()) !== -1)
      && (!filters.area || String(emp.area || '').toLowerCase().indexOf(String(filters.area).toLowerCase()) !== -1);
  });
  clearElement(tb);
  if (!list.length) {
    var empty = document.createElement('tr');
    var td = createTd('', '');
    td.colSpan = 7;
    td.innerHTML = '<div class="empty-state"><div class="empty-icon">👥</div><div class="empty-title">No employees found</div></div>';
    empty.appendChild(td);
    tb.appendChild(empty);
    return;
  }
  list.forEach(function(emp, idx){
    var tr = document.createElement('tr');
    var phoneWrap = document.createElement('div');
    phoneWrap.appendChild(createTextNodeEl('div', emp.phone || '', ''));
    phoneWrap.appendChild(createLink('💬 WA', waLink(emp.phone, getEmployeeWhatsappMessage(emp)), 'wa-btn'));
    tr.appendChild(createTd(idx + 1));
    var idTd = createTd(emp.id || '', 'td-id');
    idTd.style.cursor = 'pointer';
    idTd.addEventListener('click', function(){ viewEmployee(emp.id); });
    tr.appendChild(idTd);
    tr.appendChild(createTd(createDualLine(getEmployeeName(emp), createBadge(emp.emp_type || '', emp.emp_type === 'Nurse' ? 'bg-teal' : 'bg-blue'))));
    tr.appendChild(createTd(createDualLine(emp.dept || '-', createTextNodeEl('div', 'Score ' + calculateEmployeeScore({ scoreExperience:emp.scoreExperience, scoreBehaviour:emp.scoreBehaviour, scoreTestimonial:emp.scoreTestimonial }) + ' / 10', 'sm'))));
    tr.appendChild(createTd(emp.gender || ''));
    tr.appendChild(createTd(phoneWrap));
    tr.appendChild(createActionCell([
      createButton('Edit', 'btn btn-ghost btn-xs', function(){ editEmployee(emp.id); }),
      createButton('View', 'btn btn-outline btn-xs', function(){ viewEmployee(emp.id); }),
      createButton('PDF', 'btn btn-navy btn-xs', function(){ downloadEmployeePdf(emp.id); }),
      createButton('Delete', 'btn btn-danger btn-xs', function(){ deleteEmployee(emp.id); })
    ]));
    tb.appendChild(tr);
  });
}

function setEmpMode(mode) {
  var title = document.getElementById('empModalTitle');
  if (title) title.textContent = mode === 'create' ? 'Create Employee' : 'Edit Employee';
  var saveBtn = document.getElementById('empSaveBtn');
  if (saveBtn) saveBtn.textContent = mode === 'create' ? '💾 Save Employee' : '💾 Update Employee';
  if (mode === 'create') {
    ['ef_fn','ef_mn','ef_ln','ef_email','ef_phone','ef_phone2','ef_dob','ef_join','ef_leave','ef_exp','ef_salary','ef_aadhar','ef_pan','ef_ecname','ef_ecphone','ef_ecrel','ef_permaddr','ef_presaddr','ePin','eDist','eState'].forEach(function(id){ sv(id, ''); });
    ['ef_gender','ef_blood','ef_dept','ef_etype','ef_desig','ef_edu','ef_skills','ef_area'].forEach(function(id){ sv(id, ''); });
    sv('eShift', SHIFT_OPTIONS[0]);
    sv('empDocType', '');
    sv('ef_score_exp', '5');
    sv('ef_score_beh', '5');
    sv('ef_score_tes', '5');
    setSliderOutput('ef_score_exp','ef_score_exp_val');
    setSliderOutput('ef_score_beh','ef_score_beh_val');
    setSliderOutput('ef_score_tes','ef_score_tes_val');
    updateEmployeeScoreDisplay();
    editingEmp = null;
    empDocsBuffer = [];
    renderEmpDocList();
    updateUploadProgress('empDocProgress', '');
  }
}

function editEmployee(id) {
  editingEmp = DB.employees.find(function(emp){ return emp.id === id; });
  if (!editingEmp) return;
  setEmpMode('edit');
  ['fn','mn','ln','email','phone','phone2','dob','join','leave','exp','salary','aadhar','pan','ecname','ecphone','ecrel','permaddr','presaddr'].forEach(function(key){
    sv('ef_' + key, editingEmp[key] || '');
  });
  sv('ePin', editingEmp.pin || '');
  sv('eDist', editingEmp.district || '');
  sv('eState', editingEmp.state || '');
  sv('eShift', editingEmp.shift || SHIFT_OPTIONS[0]);
  sv('ef_gender', editingEmp.gender || '');
  sv('ef_blood', editingEmp.blood || '');
  sv('ef_dept', editingEmp.dept || '');
  sv('ef_etype', editingEmp.emp_type || editingEmp.etype || '');
  sv('ef_desig', editingEmp.desig || '');
  sv('ef_edu', editingEmp.edu || '');
  sv('ef_skills', editingEmp.skills || '');
  sv('ef_area', editingEmp.area || '');
  sv('ef_score_exp', editingEmp.scoreExperience || '5');
  sv('ef_score_beh', editingEmp.scoreBehaviour || '5');
  sv('ef_score_tes', editingEmp.scoreTestimonial || '5');
  ['ef_score_exp','ef_score_beh','ef_score_tes'].forEach(function(id, idx){
    var outIds = ['ef_score_exp_val','ef_score_beh_val','ef_score_tes_val'];
    setSliderOutput(id, outIds[idx]);
  });
  updateEmployeeScoreDisplay();
  empDocsBuffer = (editingEmp.docs || []).map(function(doc){ return Object.assign({}, doc); });
  renderEmpDocList();
  openModal('empModal');
}

function saveEmployee() {
  var firstName = gv('ef_fn').trim();
  var phone = gv('ef_phone').trim();
  if (!firstName || !phone) {
    toast('First name and phone are required','error');
    return;
  }
  if (!gv('ef_etype')) {
    toast('Select employee type','error');
    return;
  }
  if (!(empDocsBuffer || []).some(function(doc){ return doc.category === 'Aadhar Card'; })) {
    toast('Aadhar Card upload is mandatory before saving','error');
    return;
  }
  var data = {
    fn: firstName,
    mn: gv('ef_mn'),
    ln: gv('ef_ln').trim(),
    email: gv('ef_email'),
    phone: phone,
    phone2: gv('ef_phone2'),
    gender: gv('ef_gender'),
    dob: gv('ef_dob'),
    blood: gv('ef_blood'),
    dept: gv('ef_dept'),
    etype: gv('ef_etype'),
    emp_type: gv('ef_etype'),
    desig: gv('ef_desig'),
    edu: gv('ef_edu'),
    join: gv('ef_join'),
    leave: gv('ef_leave'),
    exp: gv('ef_exp'),
    shift: gv('eShift'),
    salary: gv('ef_salary'),
    aadhar: gv('ef_aadhar'),
    pan: gv('ef_pan'),
    permaddr: gv('ef_permaddr'),
    presaddr: gv('ef_presaddr'),
    pin: gv('ePin'),
    district: gv('eDist'),
    state: gv('eState'),
    ecname: gv('ef_ecname'),
    ecphone: gv('ef_ecphone'),
    ecrel: gv('ef_ecrel'),
    skills: gv('ef_skills'),
    area: gv('ef_area'),
    scoreExperience: gv('ef_score_exp'),
    scoreBehaviour: gv('ef_score_beh'),
    scoreTestimonial: gv('ef_score_tes'),
    scoreTotal: calculateEmployeeScore({ scoreExperience:gv('ef_score_exp'), scoreBehaviour:gv('ef_score_beh'), scoreTestimonial:gv('ef_score_tes') }),
    docs: empDocsBuffer.map(function(doc){ return Object.assign({}, doc); })
  };
  if (editingEmp) {
    Object.assign(editingEmp, data);
    if (SB_READY) sbUpsert('hh_employees', [toSbEmployee(editingEmp)]);
    recordAudit('employee', editingEmp.id, 'edit', buildStampText('Last edited employee'), { name:getEmployeeName(editingEmp) });
    toast('Employee updated');
  } else {
    var employee = Object.assign({}, data, {
      id: 'EMP' + Date.now().toString().slice(-9),
      created: fmtDate(new Date())
    });
    DB.employees.unshift(employee);
    if (SB_READY) sbUpsert('hh_employees', [toSbEmployee(employee)]);
    recordAudit('employee', employee.id, 'create', buildStampText('Added employee'), { name:getEmployeeName(employee) });
    toast('Employee created');
  }
  saveDB();
  closeModal('empModal');
  editingEmp = null;
  renderEmployees();
}

function deleteEmployee(id) {
  if (!confirm('Delete this employee?')) return;
  DB.employees = DB.employees.filter(function(emp){ return emp.id !== id; });
  if (SB_READY) sbDelete('hh_employees', id);
  recordAudit('employee', id, 'delete', buildStampText('Deleted employee'), {});
  saveDB();
  renderEmployees();
  toast('Employee deleted');
}

function viewEmployee(id) {
  var employee = DB.employees.find(function(row){ return row.id === id; });
  if (!employee) return;
  currentEmployeeViewId = id;
  var content = document.getElementById('empViewContent');
  if (!content) return;
  var html = [];
  html.push(buildInfoGrid([
    { key:'Employee ID', value:employee.id },
    { key:'Name', value:getEmployeeName(employee) },
    { key:'Type', value:employee.emp_type || employee.etype || '-' },
    { key:'Designation', value:employee.desig || '-' },
    { key:'Department', value:employee.dept || '-' },
    { key:'Education', value:employee.edu || '-' },
    { key:'Shift', value:employee.shift || '-' },
    { key:'Area', value:employee.area || '-' },
    { key:'Job Profile', value:employee.skills || '-' },
    { key:'Experience Score', value:(employee.scoreExperience || '0') + ' / 10' },
    { key:'Behaviour Score', value:(employee.scoreBehaviour || '0') + ' / 10' },
    { key:'Testimonial Score', value:(employee.scoreTestimonial || '0') + ' / 10' },
    { key:'Overall Score', value:(employee.scoreTotal || calculateEmployeeScore(employee)) + ' / 10' },
    { key:'Phone', value:employee.phone || '-' },
    { key:'Email', value:employee.email || '-' },
    { key:'Address', value:employee.permaddr || '-' }
  ]));
  var stamps = getStampLines('employee', employee.id);
  if (stamps.length) {
    html.push('<div class="card" style="margin-top:14px"><div class="card-hdr"><span class="card-title">Audit Stamp</span></div><div class="card-body"><div class="sm">' + stamps.join('<br>') + '</div></div></div>');
  }
  html.push('<div class="card" style="margin-top:14px"><div class="card-hdr"><span class="card-title">Documents</span></div><div class="card-body"><div id="empViewDocWrap" class="doc-list"></div></div></div>');
  content.innerHTML = html.join('');
  var wrap = document.getElementById('empViewDocWrap');
  clearElement(wrap);
  (employee.docs || []).forEach(function(doc){
    var item = createTextNodeEl('div', '', 'doc-item');
    var meta = createTextNodeEl('div', '', 'doc-meta');
    meta.appendChild(createTextNodeEl('div', doc.name, 'doc-name'));
    meta.appendChild(createTextNodeEl('div', (doc.category || 'Document') + ' · ' + formatFileSize(doc.size || 0), 'doc-sub'));
    var actions = createTextNodeEl('div', '', 'doc-actions');
    actions.appendChild(createButton('Open', 'btn btn-ghost btn-xs', function(){ downloadEmployeeDoc(doc.id); }));
    item.appendChild(meta);
    item.appendChild(actions);
    wrap.appendChild(item);
  });
  var waBtn = document.getElementById('empViewWaBtn');
  if (waBtn) waBtn.href = waLink(employee.phone, getEmployeeWhatsappMessage(employee));
  openModal('empViewModal');
}

function renderPatients() {
  ensureActivePatientBillings();
  var q = ((document.getElementById('patSearch') || {}).value || '').toLowerCase();
  var sf = gv('patStatusFilter');
  var gf = gv('patGenderFilter');
  var af = ((document.getElementById('patAreaFilter') || {}).value || '').toLowerCase();
  var pf = ((document.getElementById('patPinFilter') || {}).value || '').toLowerCase();
  var tb = document.getElementById('patBody');
  if (!tb) return;
  var list = DB.patients.slice().sort(function(a, b){
    var metaA = getPatientStatusMeta(a);
    var metaB = getPatientStatusMeta(b);
    if (metaA.priority !== metaB.priority) return metaA.priority - metaB.priority;
    var createdA = parseAppDate(a.created) || new Date(0);
    var createdB = parseAppDate(b.created) || new Date(0);
    return createdB.getTime() - createdA.getTime();
  }).filter(function(patient){
    var meta = getPatientStatusMeta(patient);
    return (!q || String(patient.name || '').toLowerCase().indexOf(q) !== -1 || String(patient.id || '').toLowerCase().indexOf(q) !== -1 || String(patient.phone || '').indexOf(q) !== -1)
      && (!sf || meta.label === sf || String(patient.status || '') === sf)
      && (!gf || String(patient.gender || '') === gf)
      && (!af || String(patient.area || '').toLowerCase().indexOf(af) !== -1)
      && (!pf || String(patient.pin || '').indexOf(pf) !== -1);
  });
  clearElement(tb);
  if (!list.length) {
    var empty = document.createElement('tr');
    var td = createTd('', '');
    td.colSpan = 7;
    td.innerHTML = '<div class="empty-state"><div class="empty-icon">🏥</div><div class="empty-title">No patients found</div></div>';
    empty.appendChild(td);
    tb.appendChild(empty);
    return;
  }
  list.forEach(function(patient, idx){
    var meta = getPatientStatusMeta(patient);
    var dob = parseAppDate(patient.dob);
    var age = dob ? Math.floor((Date.now() - dob.getTime()) / 31557600000) : '';
    var tr = document.createElement('tr');
    tr.className = meta.rowClass || '';
    var idTd = createTd(patient.id || '', 'td-id');
    idTd.style.cursor = 'pointer';
    idTd.addEventListener('click', function(){ viewPatient(patient.id); });
    var phoneWrap = document.createElement('div');
    phoneWrap.appendChild(createTextNodeEl('div', patient.phone || '', ''));
    phoneWrap.appendChild(createLink('💬 WA', waLink(patient.phone, getPatientWhatsappMessage(patient)), 'wa-btn'));
    tr.appendChild(createTd(idx + 1));
    tr.appendChild(idTd);
    tr.appendChild(createTd(createDualLine(patient.name || '', createBadge(meta.label, meta.badge.replace('bdg', 'bg')))));
    tr.appendChild(createTd((age ? age + ' / ' : '') + (patient.gender || '-')));
    tr.appendChild(createTd(phoneWrap));
    tr.appendChild(createTd(patient.created || ''));
    tr.appendChild(createActionCell([
      createButton('Edit', 'btn btn-ghost btn-xs', function(){ editPat(patient.id); }),
      createButton(DB.billings[patient.id] ? 'Billing' : 'Start', DB.billings[patient.id] ? 'btn btn-outline btn-xs' : 'btn btn-success btn-xs', function(){
        if (DB.billings[patient.id]) viewPatient(patient.id);
        else askStartServices(patient.id);
      })
    ]));
    tb.appendChild(tr);
  });
}

function setPatMode(mode) {
  var title = document.getElementById('patModalTitle');
  if (title) title.textContent = mode === 'create' ? 'Create Patient' : 'Edit Patient';
  var saveBtn = document.getElementById('patSaveBtn');
  if (saveBtn) saveBtn.textContent = mode === 'create' ? '🏥 Register' : '🏥 Update Patient';
  if (mode === 'create') {
    ['pf_name','pf_email','pf_phone','pf_dob','pf_addr','pf_area','pf_city','pf_pin','pf_relname','pf_relphone','pf_relname2','pf_relphone2','pf_relname3','pf_relphone3'].forEach(function(id){ sv(id, ''); });
    sv('pf_gender', '');
    sv('pf_blood', '');
    sv('pf_status', 'Active');
    patPhotoBuffer = null;
    patDocsBuffer = [];
    renderPatientPhotoPreview();
    renderPatientDocList();
    editingPat = null;
  }
}

function editPat(id) {
  editingPat = DB.patients.find(function(patient){ return patient.id === id; });
  if (!editingPat) return;
  setPatMode('edit');
  ['name','email','phone','addr','area','city','pin','relname','relphone','relname2','relphone2','relname3','relphone3'].forEach(function(key){
    sv('pf_' + key, editingPat[key] || '');
  });
  setDateFieldValue('pf_dob', editingPat.dob || '');
  sv('pf_gender', editingPat.gender || '');
  sv('pf_blood', editingPat.blood || '');
  sv('pf_status', editingPat.status || 'Active');
  patPhotoBuffer = editingPat.photo ? Object.assign({}, editingPat.photo) : null;
  patDocsBuffer = (editingPat.docs || []).map(function(doc){ return Object.assign({}, doc); });
  renderPatientPhotoPreview();
  renderPatientDocList();
  openModal('patModal');
}

function savePatient() {
  var name = gv('pf_name').trim();
  var phone = gv('pf_phone').trim();
  if (!name || !phone) {
    toast('Patient name and phone are required','error');
    return;
  }
  handlePatientPinChange(true);
  var data = {
    name: name,
    email: gv('pf_email'),
    phone: phone,
    dob: gv('pf_dob'),
    gender: gv('pf_gender'),
    blood: gv('pf_blood'),
    addr: gv('pf_addr'),
    area: gv('pf_area'),
    city: gv('pf_city'),
    pin: gv('pf_pin'),
    relname: gv('pf_relname'),
    relphone: gv('pf_relphone'),
    relname2: gv('pf_relname2'),
    relphone2: gv('pf_relphone2'),
    relname3: gv('pf_relname3'),
    relphone3: gv('pf_relphone3'),
    status: gv('pf_status') || 'Active',
    photo: patPhotoBuffer ? Object.assign({}, patPhotoBuffer) : null,
    docs: patDocsBuffer.map(function(doc){ return Object.assign({}, doc); })
  };
  if (editingPat) {
    Object.assign(editingPat, data);
    if (SB_READY) sbUpsert('hh_patients', [toSbPatient(editingPat)]);
    recordAudit('patient', editingPat.id, 'edit', buildStampText('Last edited patient'), { name:editingPat.name });
    toast('Patient updated');
  } else {
    var next = DB.nextIds.pat || 1;
    DB.nextIds.pat = next + 1;
    var patient = Object.assign({}, data, {
      id: 'PID' + String(next).padStart(6, '0'),
      created: fmtDate(new Date())
    });
    DB.patients.unshift(patient);
    if (patient.status === 'Active') createBillingForPatient(patient, true);
    if (SB_READY) sbUpsert('hh_patients', [toSbPatient(patient)]);
    recordAudit('patient', patient.id, 'create', buildStampText('Created patient'), { name:patient.name });
    toast('Patient created');
  }
  saveDB();
  closeModal('patModal');
  editingPat = null;
  renderPatients();
}

function startServices() {
  closeModal('startModal');
  var patient = DB.patients.find(function(row){ return row.id === currentBillingPatId; });
  if (!patient) return;
  var bill = createBillingForPatient(patient, true);
  if (bill) {
    bill.status = 'Active';
    patient.status = 'Active';
    if (SB_READY) {
      sbUpsert('hh_billings', [getBillingSyncPayload(bill, patient.id)]);
      sbUpsert('hh_patients', [toSbPatient(patient)]);
    }
    recordAudit('billing', patient.id, 'create', buildStampText('Start billing'), { billId:bill.id, patientName:patient.name });
    saveDB();
  }
  viewPatient(currentBillingPatId);
}

function doCloseBill() {
  var reason = gv('closeReason');
  var other = gv('closeReasonOther');
  if (!reason) {
    toast('Closing reason is required','error');
    return;
  }
  if (reason === 'Other' && !other.trim()) {
    toast('Enter other reason','error');
    return;
  }
  closeModal('closeBillModal');
  var bill = DB.billings[currentBillingPatId];
  var patient = DB.patients.find(function(row){ return row.id === currentBillingPatId; });
  if (!bill || !patient) return;
  bill.status = 'Closed';
  bill.close_reason = reason;
  bill.close_reason_other = other || '';
  patient.status = reason === 'Deceased' ? 'Deceased' : 'Closed';
  patient.status_reason = reason;
  patient.status_reason_other = other || '';
  syncBillingSecurityAmount(currentBillingPatId);
  if (SB_READY) {
    sbUpsert('hh_billings', [getBillingSyncPayload(bill, currentBillingPatId)]);
    sbUpsert('hh_patients', [toSbPatient(patient)]);
  }
  recordAudit('billing', currentBillingPatId, 'close', buildStampText('Closed bill'), { reason:reason, other:other || '' });
  saveDB();
  viewPatient(currentBillingPatId);
  toast('Bill closed');
}

function doPauseBill() {
  closeModal('pauseBillModal');
  var bill = DB.billings[currentBillingPatId];
  var patient = DB.patients.find(function(row){ return row.id === currentBillingPatId; });
  if (!bill || !patient) return;
  bill.status = 'Paused';
  patient.status = 'Paused';
  bill.pause_reason = gv('pauseReason');
  if (SB_READY) {
    sbUpsert('hh_billings', [getBillingSyncPayload(bill, currentBillingPatId)]);
    sbUpsert('hh_patients', [toSbPatient(patient)]);
  }
  recordAudit('billing', currentBillingPatId, 'pause', buildStampText('Paused bill'), { reason:gv('pauseReason') });
  saveDB();
  viewPatient(currentBillingPatId);
  toast('Bill paused');
}

function viewPatient(patId) {
  currentBillingPatId = patId;
  syncRecurringServiceData();
  var patient = DB.patients.find(function(row){ return row.id === patId; });
  if (!patient) return;
  if (!DB.billings[patId] && getPatientStatusMeta(patient).label === 'Active') createBillingForPatient(patient, true);
  var bill = DB.billings[patId];
  if (!bill) {
    toast('No billing available for this patient','info');
    return;
  }
  var money = getBillingFinancials(patId);
  setEl('bdPatName', patient.name + ' | ' + patient.id);
  setEl('bdPatPhone', patient.phone || '');
  setEl('bdPatRelative', patient.relname ? patient.relname + ' : ' + (patient.relphone || '') : '-');
  setEl('bdSecDep', money.secDep.toFixed(2));
  setEl('bdTotal', money.total.toFixed(2));
  setEl('bdAdvance', money.advanceDisplay.toFixed(2));
  setEl('bdOutstanding', money.outstanding.toFixed(2));
  setEl('bdAdvanceLabel', bill.status === 'Closed' ? 'Advance + Security Adjusted' : 'Advance Paid');
  var statusBadge = document.getElementById('bdBillStatus');
  if (statusBadge) {
    statusBadge.textContent = bill.status || 'Active';
    statusBadge.className = 'badge ' + (bill.status === 'Closed' ? 'bg-red' : bill.status === 'Paused' ? 'bg-amber' : 'bg-green');
  }
  var sr = document.getElementById('serviceRows');
  if (sr) {
    clearElement(sr);
    BILLING_SERVICES.forEach(function(serviceName){
      var key = (bill.id || '') + '_' + serviceName;
      var entries = (DB.svcEntries[key] || []).slice();
      var total = entries.reduce(function(sum, entry){ return sum + (parseFloat(entry.total) || 0); }, 0);
      var row = createTextNodeEl('div', '', 'service-row');
      var nameNode = createTextNodeEl('div', serviceName, 'service-row-name');
      var rhs = document.createElement('div');
      rhs.style.display = 'flex';
      rhs.style.alignItems = 'center';
      rhs.style.gap = '12px';
      rhs.appendChild(createBadge(entries.length + ' entries', 'bg-gray'));
      rhs.appendChild(createTextNodeEl('span', formatCurrency(total), 'service-row-amt'));
      var plus = createTextNodeEl('div', '+', 'service-expand-btn');
      rhs.appendChild(plus);
      row.appendChild(nameNode);
      row.appendChild(rhs);
      row.addEventListener('click', function(){ openService(serviceName, bill.id); });
      sr.appendChild(row);
    });
  }
  var receiptBody = document.getElementById('bdReceiptBody');
  clearElement(receiptBody);
  var receipts = money.receipts || [];
  if (!receipts.length) {
    var emptyRow = document.createElement('tr');
    var emptyTd = createTd('', '');
    emptyTd.colSpan = 8;
    emptyTd.textContent = 'No receipts yet';
    emptyRow.appendChild(emptyTd);
    receiptBody.appendChild(emptyRow);
  } else {
    receipts.forEach(function(receipt, idx){
      var tr = document.createElement('tr');
      tr.appendChild(createTd(idx + 1));
      tr.appendChild(createTd(receipt.id || '', 'td-id'));
      tr.appendChild(createTd(receipt.date || ''));
      tr.appendChild(createTd(receipt.type || ''));
      tr.appendChild(createTd((parseFloat(receipt.amount) || 0).toFixed(2), 'fw7'));
      tr.appendChild(createTd(receipt.method || ''));
      tr.appendChild(createTd(receipt.ref || ''));
      tr.appendChild(createTd(receipt.remarks || ''));
      receiptBody.appendChild(tr);
    });
  }
  var closeAudit = getPatientLatestCloseAudit(patId);
  var billingHeader = document.querySelector('#page-billing-detail .billing-hdr');
  var existingNote = document.getElementById('billingCloseReasonNote');
  if (existingNote) existingNote.parentNode.removeChild(existingNote);
  if (billingHeader && closeAudit && closeAudit.meta && closeAudit.meta.reason) {
    var note = createTextNodeEl('div', 'Close Reason: ' + closeAudit.meta.reason + (closeAudit.meta.other ? ' - ' + closeAudit.meta.other : ''), 'sm mt8');
    note.id = 'billingCloseReasonNote';
    billingHeader.appendChild(note);
  }
  nav('billing-detail');
}

function calcSvcTotal() {
  var amount = parseFloat(gv('svcAmt')) || 0;
  var count = parseFloat(gv('svcCount')) || 1;
  var discount = parseFloat(gv('svcDisc')) || 0;
  var absent = parseFloat(gv('svcAbsent')) || 0;
  var effectiveCount = Math.max(0, count - absent);
  sv('svcTotalField', Math.max(0, (amount * effectiveCount) - discount).toFixed(2));
}

function openService(svcName, billId) {
  currentSvcName = svcName;
  currentBillIdForSvc = billId;
  var saveBtn = document.getElementById('svcSaveBtn');
  if (saveBtn) saveBtn.textContent = '+ Add Entry';
  editingSvcEntryIndex = null;
  var key = billId + '_' + svcName;
  var entries = (DB.svcEntries[key] || []).slice().sort(function(a, b){
    return (parseAppDate(a.date) || new Date(0)).getTime() - (parseAppDate(b.date) || new Date(0)).getTime();
  });
  var last = entries.length ? entries[entries.length - 1] : null;
  selectedPartner = last && last.partner ? { name:last.partner } : null;
  setEl('svcDetailTitle', svcName);
  setEl('svcPartnerName', last && last.partner ? last.partner : 'Not assigned');
  sv('svcDate', todayIso());
  sv('svcFreq', last ? (last.freq || 'Daily') : 'Daily');
  sv('svcAmt', last ? (parseFloat(last.amt) || 0) : '');
  sv('svcCount', last ? (parseFloat(last.count) || 1) : '1');
  sv('svcAbsent', '0');
  sv('svcDisc', last ? (parseFloat(last.disc) || 0) : '0');
  sv('svcRemarks', '');
  calcSvcTotal();
  renderSvcEntries();
  nav('service-detail');
}

function confirmPartnerPick() {
  var selected = document.querySelector('#partnerPickBody input[name="partnerPick"]:checked');
  if (!selected) {
    toast('Select partner','error');
    return;
  }
  selectedPartner = { id:selected.value, name:selected.getAttribute('data-name') };
  setEl('svcPartnerName', selectedPartner.name);
  closeModal('partnerModal');
  recordAudit('service', (currentBillIdForSvc + '_' + currentSvcName), 'assign-partner', buildStampText('Assigned partner'), { partner:selectedPartner.name });
  toast('Partner assigned');
}

function addSvcEntry() {
  var date = gv('svcDate');
  var frequency = gv('svcFreq') || 'Daily';
  var amount = parseFloat(gv('svcAmt')) || 0;
  var count = parseFloat(gv('svcCount')) || 1;
  var absent = parseFloat(gv('svcAbsent')) || 0;
  var discount = parseFloat(gv('svcDisc')) || 0;
  var remarks = gv('svcRemarks');
  if (!date || !amount) {
    toast('Date and rate are required','error');
    return;
  }
  var key = currentBillIdForSvc + '_' + currentSvcName;
  if (!DB.svcEntries[key]) DB.svcEntries[key] = [];
  var row = {
    partner: selectedPartner ? selectedPartner.name : '',
    date: fmtDateStr(date),
    freq: frequency,
    amt: amount,
    count: count,
    absent: absent,
    disc: discount,
    total: parseFloat(gv('svcTotalField')) || 0,
    remarks: remarks,
    svc_key: key,
    billing_id: currentBillIdForSvc,
    service_name: currentSvcName
  };
  if (editingSvcEntryIndex !== null && DB.svcEntries[key][editingSvcEntryIndex]) {
    Object.assign(DB.svcEntries[key][editingSvcEntryIndex], row);
    recordAudit('service', key, 'edit-entry', buildStampText('Edited service entry'), { service:currentSvcName, date:row.date });
    toast('Service entry updated');
  } else {
    DB.svcEntries[key].push(row);
    recordAudit('service', key, 'create-entry', buildStampText('Added service entry'), { service:currentSvcName, date:row.date });
    toast('Service entry added');
  }
  DB.svcEntries[key].sort(function(a, b){
    return (parseAppDate(a.date) || new Date(0)).getTime() - (parseAppDate(b.date) || new Date(0)).getTime();
  });
  editingSvcEntryIndex = null;
  if (SB_READY) syncServiceEntriesToSupabase(key);
  saveDB();
  renderSvcEntries();
  sv('svcDate', todayIso());
  sv('svcAmt', '');
  sv('svcCount', '1');
  sv('svcAbsent', '0');
  sv('svcDisc', '0');
  sv('svcRemarks', '');
  sv('svcTotalField', '');
}

function renderSvcEntries() {
  var key = currentBillIdForSvc + '_' + currentSvcName;
  var entries = (DB.svcEntries[key] || []).slice().sort(function(a, b){
    return (parseAppDate(a.date) || new Date(0)).getTime() - (parseAppDate(b.date) || new Date(0)).getTime();
  });
  var tb = document.getElementById('svcEntryBody');
  if (!tb) return;
  clearElement(tb);
  if (!entries.length) {
    var empty = document.createElement('tr');
    var td = createTd('No entries yet', '');
    td.colSpan = 10;
    empty.appendChild(td);
    tb.appendChild(empty);
    return;
  }
  entries.forEach(function(entry, idx){
    var tr = document.createElement('tr');
    tr.appendChild(createTd(idx + 1));
    tr.appendChild(createTd(entry.date || ''));
    tr.appendChild(createTd(entry.freq || ''));
    tr.appendChild(createTd((parseFloat(entry.amt) || 0).toFixed(2)));
    tr.appendChild(createTd((parseFloat(entry.count) || 0) + ''));
    tr.appendChild(createTd((parseFloat(entry.disc) || 0).toFixed(2)));
    tr.appendChild(createTd((parseFloat(entry.total) || 0).toFixed(2), 'fw7'));
    tr.appendChild(createTd(entry.partner || '-'));
    tr.appendChild(createTd((entry.remarks || '') + (entry.absent ? ' | Absent: ' + entry.absent : '')));
    tr.appendChild(createActionCell([
      createButton('Payout', 'btn btn-ghost btn-xs', function(){ openPayoutCharges(idx); }),
      createButton('Edit', 'btn btn-outline btn-xs', function(){
        editingSvcEntryIndex = idx;
        if (entry.partner) {
          selectedPartner = { name:entry.partner };
          setEl('svcPartnerName', entry.partner);
        }
        sv('svcDate', toDateInputValue(entry.date));
        sv('svcFreq', entry.freq || 'Daily');
        sv('svcAmt', parseFloat(entry.amt) || 0);
        sv('svcCount', parseFloat(entry.count) || 1);
        sv('svcAbsent', parseFloat(entry.absent) || 0);
        sv('svcDisc', parseFloat(entry.disc) || 0);
        sv('svcRemarks', entry.remarks || '');
        calcSvcTotal();
        var saveBtn = document.getElementById('svcSaveBtn');
        if (saveBtn) saveBtn.textContent = 'Update Entry';
      }),
      createButton('Delete', 'btn btn-danger btn-xs', function(){
        if (!confirm('Delete this service entry?')) return;
        DB.svcEntries[key].splice(idx, 1);
        if (SB_READY) syncServiceEntriesToSupabase(key);
        recordAudit('service', key, 'delete-entry', buildStampText('Deleted service entry'), { service:currentSvcName, date:entry.date });
        saveDB();
        renderSvcEntries();
      })
    ]));
    tb.appendChild(tr);
  });
}

function openPayoutCharges() {
  syncRecurringServiceData();
  var backBtn = document.getElementById('payChargesBackBtn');
  if (backBtn) backBtn.onclick = function(){ openService(currentSvcName, currentBillIdForSvc); };
  var partnerSelect = document.getElementById('pcPartner');
  if (partnerSelect) {
    clearElement(partnerSelect);
    var placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Select';
    partnerSelect.appendChild(placeholder);
    DB.employees.forEach(function(emp){
      var opt = document.createElement('option');
      opt.value = getEmployeeName(emp);
      opt.textContent = getEmployeeName(emp);
      partnerSelect.appendChild(opt);
    });
  }
  editingPayoutIndex = null;
  var key = currentBillIdForSvc + '_' + currentSvcName;
  var last = (DB.payoutCharges[key] || []).slice().pop();
  sv('pcDate', todayIso());
  sv('pcPartner', last ? (last.partner || '') : (selectedPartner ? selectedPartner.name : ''));
  sv('pcTerm', last ? (last.term || 'Daily') : 'Daily');
  sv('pcAmt', last ? (parseFloat(last.amount) || 0) : '0');
  sv('pcRemarks', '');
  renderPayoutCharges();
  nav('payout-charges');
}

function addPayoutCharge() {
  var date = gv('pcDate');
  var partner = gv('pcPartner');
  var term = gv('pcTerm') || 'Daily';
  var amount = parseFloat(gv('pcAmt')) || 0;
  var remarks = gv('pcRemarks');
  if (!date || !partner || !amount) {
    toast('Date, partner, and amount are required','error');
    return;
  }
  var key = currentBillIdForSvc + '_' + currentSvcName;
  if (!DB.payoutCharges[key]) DB.payoutCharges[key] = [];
  var row = { date:fmtDateStr(date), partner:partner, term:term, amount:amount, remarks:remarks, svc_key:key };
  if (editingPayoutIndex !== null && DB.payoutCharges[key][editingPayoutIndex]) {
    Object.assign(DB.payoutCharges[key][editingPayoutIndex], row);
    recordAudit('payout-charge', key, 'edit', buildStampText('Updated payout charge'), { partner:partner, amount:amount });
    toast('Charge updated');
  } else {
    DB.payoutCharges[key].push(row);
    recordAudit('payout-charge', key, 'create', buildStampText('Added payout charge'), { partner:partner, amount:amount });
    toast('Charge added');
  }
  if (SB_READY) syncPayoutChargesToSupabase(key);
  saveDB();
  editingPayoutIndex = null;
  renderPayoutCharges();
  sv('pcDate', todayIso());
  sv('pcAmt', '0');
  sv('pcRemarks', '');
}

function renderPayoutCharges() {
  var key = currentBillIdForSvc + '_' + currentSvcName;
  var entries = (DB.payoutCharges[key] || []).slice().sort(function(a, b){
    return (parseAppDate(a.date) || new Date(0)).getTime() - (parseAppDate(b.date) || new Date(0)).getTime();
  });
  var tb = document.getElementById('pcBody');
  if (!tb) return;
  clearElement(tb);
  if (!entries.length) {
    var empty = document.createElement('tr');
    var td = createTd('No charges yet', '');
    td.colSpan = 7;
    empty.appendChild(td);
    tb.appendChild(empty);
    return;
  }
  entries.forEach(function(entry, idx){
    var tr = document.createElement('tr');
    tr.appendChild(createTd(idx + 1));
    tr.appendChild(createTd(entry.date || ''));
    tr.appendChild(createTd(entry.partner || '', 'td-name'));
    tr.appendChild(createTd(entry.term || ''));
    tr.appendChild(createTd((parseFloat(entry.amount) || 0).toFixed(2), 'fw7'));
    tr.appendChild(createTd(entry.remarks || ''));
    tr.appendChild(createActionCell([
      createButton('Edit', 'btn btn-outline btn-xs', function(){
        editingPayoutIndex = idx;
        sv('pcDate', toDateInputValue(entry.date));
        sv('pcPartner', entry.partner || '');
        sv('pcTerm', entry.term || 'Daily');
        sv('pcAmt', parseFloat(entry.amount) || 0);
        sv('pcRemarks', entry.remarks || '');
      }),
      createButton('Delete', 'btn btn-danger btn-xs', function(){
        if (!confirm('Delete this payout charge?')) return;
        DB.payoutCharges[key].splice(idx, 1);
        if (SB_READY) syncPayoutChargesToSupabase(key);
        recordAudit('payout-charge', key, 'delete', buildStampText('Deleted payout charge'), { partner:entry.partner, amount:entry.amount });
        saveDB();
        renderPayoutCharges();
      })
    ]));
    tb.appendChild(tr);
  });
}

function addReceipt() {
  var date = gv('rcDate');
  var type = gv('rcType');
  var amount = parseFloat(gv('rcAmt')) || 0;
  var method = gv('rcMethod');
  var ref = gv('rcRef');
  var remarks = gv('rcRemarks');
  if (!date || !type || !amount || !method) {
    toast('Date, type, amount and method are required','error');
    return;
  }
  var billingId = (DB.billings[currentBillingPatId] || {}).id;
  if (!billingId) {
    toast('No active billing found','error');
    return;
  }
  if (!DB.receipts[billingId]) DB.receipts[billingId] = [];
  var next = DB.nextIds.receipt || 100;
  DB.nextIds.receipt = next + 1;
  var receipt = {
    id: 'RECB' + String(next).padStart(6, '0'),
    date: fmtDateStr(date),
    type: type,
    amount: amount,
    method: method,
    ref: ref,
    remarks: remarks,
    billing_id: billingId
  };
  DB.receipts[billingId].push(receipt);
  syncBillingSecurityAmount(currentBillingPatId);
  if (SB_READY) sbUpsert('hh_receipts', [toSbReceipt(receipt)]);
  recordAudit('receipt', receipt.id, 'create', buildStampText('Added receipt'), { cashier:getCurrentUser().username, amount:amount });
  saveDB();
  renderReceipts();
  toast('Receipt added');
}

function renderReceipts() {
  var billingId = (DB.billings[currentBillingPatId] || {}).id;
  var entries = billingId ? (DB.receipts[billingId] || []) : [];
  var tb = document.getElementById('rcBody');
  if (!tb) return;
  clearElement(tb);
  if (!entries.length) {
    var empty = document.createElement('tr');
    var td = createTd('No receipts yet', '');
    td.colSpan = 9;
    empty.appendChild(td);
    tb.appendChild(empty);
    return;
  }
  entries.forEach(function(receipt, idx){
    var tr = document.createElement('tr');
    tr.appendChild(createTd(idx + 1));
    tr.appendChild(createTd(receipt.id || '', 'td-id'));
    tr.appendChild(createTd(receipt.date || ''));
    tr.appendChild(createTd(receipt.type || ''));
    tr.appendChild(createTd((parseFloat(receipt.amount) || 0).toFixed(2), 'fw7'));
    tr.appendChild(createTd(receipt.method || ''));
    tr.appendChild(createTd(receipt.ref || ''));
    tr.appendChild(createTd(receipt.remarks || ''));
    tr.appendChild(createActionCell([
      createButton('PDF', 'btn btn-navy btn-xs', function(){ downloadReceiptsPdf(currentBillingPatId, receipt.id); }),
      createButton('Delete', 'btn btn-danger btn-xs', function(){
        if (!confirm('Delete this receipt?')) return;
        DB.receipts[billingId].splice(idx, 1);
        if (SB_READY) sbDelete('hh_receipts', receipt.id);
        recordAudit('receipt', receipt.id, 'delete', buildStampText('Deleted receipt'), { amount:receipt.amount });
        saveDB();
        renderReceipts();
      })
    ]));
    tb.appendChild(tr);
  });
}

function setInqMode(mode) {
  var title = document.getElementById('inqModalTitle');
  if (title) title.textContent = mode === 'create' ? 'New Inquiry' : 'Edit Inquiry';
  if (mode === 'create') {
    ['iq_name','iq_phone','iq_wa','iq_age','iq_city','iq_area','iq_notes','iq_followup'].forEach(function(id){ sv(id, ''); });
    ['iq_gender','iq_service','iq_source','iq_status','iq_assigned'].forEach(function(id){ sv(id, ''); });
    sv('iq_potential', 'Warm');
    sv('iq_status', 'New');
    ['iq_r1','iq_r2','iq_r3'].forEach(function(id){ sv(id, '5'); });
    ['iq_r1_val','iq_r2_val','iq_r3_val'].forEach(function(id){ setEl(id, '5'); });
    sv('iq_followup', todayIso());
    editingInq = null;
  }
  var assigned = document.getElementById('iq_assigned');
  if (assigned) {
    clearElement(assigned);
    var placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Select staff';
    assigned.appendChild(placeholder);
    DB.users.forEach(function(user){
      var opt = document.createElement('option');
      opt.value = user.username || '';
      opt.textContent = user.username || '';
      assigned.appendChild(opt);
    });
  }
}

function saveInquiry() {
  var name = gv('iq_name').trim();
  var phone = gv('iq_phone').trim();
  if (!name || !phone) {
    toast('Name and phone are required','error');
    return;
  }
  var data = {
    name: name,
    phone: phone,
    wa: gv('iq_wa'),
    age: gv('iq_age'),
    gender: gv('iq_gender'),
    city: gv('iq_city'),
    area: gv('iq_area'),
    service: gv('iq_service'),
    source: gv('iq_source'),
    potential: gv('iq_potential') || 'Warm',
    rating_emergency: parseInt(gv('iq_r1'), 10) || 5,
    rating_flexibility: parseInt(gv('iq_r2'), 10) || 5,
    rating_overall: parseInt(gv('iq_r3'), 10) || 5,
    status: gv('iq_status') || 'New',
    assigned_to: gv('iq_assigned'),
    followup_date: gv('iq_followup'),
    notes: gv('iq_notes')
  };
  if (!DB.inquiries) DB.inquiries = [];
  if (editingInq) {
    Object.assign(editingInq, data);
    if (SB_READY) sbUpsert('hh_inquiries', [toSbInquiry(editingInq)]);
    recordAudit('inquiry', editingInq.id, 'edit', buildStampText('Edited inquiry'), { name:editingInq.name });
    toast('Inquiry updated');
  } else {
    var next = DB.nextIds.inq || 1;
    DB.nextIds.inq = next + 1;
    var inquiry = Object.assign({}, data, {
      id: 'INQ' + String(next).padStart(5, '0'),
      created: fmtDate(new Date())
    });
    DB.inquiries.unshift(inquiry);
    if (SB_READY) sbUpsert('hh_inquiries', [toSbInquiry(inquiry)]);
    recordAudit('inquiry', inquiry.id, 'create', buildStampText('Created inquiry'), { name:inquiry.name });
    toast('Inquiry saved');
  }
  saveDB();
  closeModal('inqModal');
  editingInq = null;
  renderInquiries();
}

function renderInquiryRatingsCell(inquiry) {
  var wrap = document.createElement('div');
  wrap.className = 'rwrap';
  var make = function(value, color, label) {
    var row = createTextNodeEl('div', '', 'rbar');
    row.appendChild(createTextNodeEl('span', String(value), 'rbar-num'));
    var track = createTextNodeEl('div', '', 'rbar-track');
    var fill = createTextNodeEl('div', '', 'rbar-fill');
    fill.style.width = (value * 10) + '%';
    fill.style.background = color;
    track.appendChild(fill);
    row.appendChild(track);
    row.appendChild(createTextNodeEl('span', label, 'rbar-lbl'));
    wrap.appendChild(row);
  };
  make(inquiry.rating_emergency || 5, '#dc2626', 'Emer');
  make(inquiry.rating_flexibility || 5, '#16a34a', 'Flex');
  make(inquiry.rating_overall || 5, '#1565c0', 'Prior');
  return wrap;
}

function renderInquiries() {
  var q = ((document.getElementById('inqSearch') || {}).value || '').toLowerCase();
  var statusFilter = gv('inqStatusFilter');
  var sourceFilter = gv('inqSourceFilter');
  var potentialFilter = gv('inqPotentialFilter');
  var list = (DB.inquiries || []).filter(function(inquiry){
    return (!q || String(inquiry.name || '').toLowerCase().indexOf(q) !== -1 || String(inquiry.phone || '').indexOf(q) !== -1)
      && (!statusFilter || inquiry.status === statusFilter)
      && (!sourceFilter || inquiry.source === sourceFilter)
      && (!potentialFilter || inquiry.potential === potentialFilter);
  });
  var tb = document.getElementById('inqBody');
  if (!tb) return;
  clearElement(tb);
  setEl('inqHotCount', list.filter(function(inquiry){ return inquiry.potential === 'Hot'; }).length + ' Hot');
  setEl('inqWarmCount', list.filter(function(inquiry){ return inquiry.potential === 'Warm'; }).length + ' Warm');
  setEl('inqColdCount', list.filter(function(inquiry){ return inquiry.potential === 'Cold'; }).length + ' Cold');
  if (!list.length) {
    var empty = document.createElement('tr');
    var td = createTd('', '');
    td.colSpan = 10;
    td.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><div class="empty-title">No inquiries yet</div></div>';
    empty.appendChild(td);
    tb.appendChild(empty);
    return;
  }
  list.forEach(function(inquiry, idx){
    var phoneWrap = document.createElement('div');
    phoneWrap.appendChild(createTextNodeEl('div', inquiry.phone || '', ''));
    phoneWrap.appendChild(createLink('💬 WA', waLink(inquiry.wa || inquiry.phone, getInquiryWhatsappMessage(inquiry)), 'wa-btn'));
    var potentialClass = inquiry.potential === 'Hot' ? 'bg-red' : inquiry.potential === 'Cold' ? 'bg-blue' : 'bg-amber';
    var statusClass = inquiry.status === 'Converted' ? 'bg-green' : inquiry.status === 'Lost' ? 'bg-red' : inquiry.status === 'Contacted' ? 'bg-amber' : 'bg-blue';
    var tr = document.createElement('tr');
    tr.appendChild(createTd(idx + 1));
    tr.appendChild(createTd(inquiry.created || ''));
    tr.appendChild(createTd(inquiry.name || '', 'td-name'));
    tr.appendChild(createTd(phoneWrap));
    tr.appendChild(createTd(createBadge(inquiry.source || '-', 'bg-gray')));
    tr.appendChild(createTd(inquiry.service || '-'));
    tr.appendChild(createTd(createBadge(inquiry.potential || 'Warm', potentialClass)));
    tr.appendChild(createTd(renderInquiryRatingsCell(inquiry)));
    tr.appendChild(createTd(createBadge(inquiry.status || 'New', statusClass)));
    tr.appendChild(createActionCell([
      createButton('Edit', 'btn btn-ghost btn-xs', function(){ editInquiry(inquiry.id); }),
      createButton('PDF A', 'btn btn-outline btn-xs', function(){ downloadInquiryPdf(inquiry.id, true); }),
      createButton('PDF B', 'btn btn-outline btn-xs', function(){ downloadInquiryPdf(inquiry.id, false); }),
      createButton('📤 Staff', 'btn btn-success btn-xs', function(){ openInquiryShareModal(inquiry.id, false); }),
      createButton('+Pat', 'btn btn-primary btn-xs', function(){ convertInquiry(inquiry.id); }),
      createButton('Delete', 'btn btn-danger btn-xs', function(){ deleteInquiry(inquiry.id); })
    ]));
    tb.appendChild(tr);
  });
}

function openInquiryShareModal(inquiryId, withoutPhone) {
  currentInquiryShareId = inquiryId;
  currentInquiryShareMaskPhone = !!withoutPhone;
  renderInquiryShareList();
  openModal('inqShareModal');
}

function renderInquiryShareList() {
  var body = document.getElementById('inqShareBody');
  if (!body) return;
  clearElement(body);
  DB.employees.filter(function(emp){
    return EMPLOYEE_TYPES.indexOf(emp.emp_type || '') !== -1;
  }).forEach(function(emp){
    var tr = document.createElement('tr');
    var radioTd = document.createElement('td');
    var radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'inqShareTarget';
    radio.value = emp.id;
    radioTd.appendChild(radio);
    tr.appendChild(radioTd);
    tr.appendChild(createTd(emp.id || '', 'td-id'));
    tr.appendChild(createTd(getEmployeeName(emp), 'td-name'));
    tr.appendChild(createTd(emp.emp_type || ''));
    tr.appendChild(createTd(emp.phone || ''));
    body.appendChild(tr);
  });
}

function sendInquiryToSelectedStaff() {
  var selected = document.querySelector('input[name="inqShareTarget"]:checked');
  if (!selected) {
    toast('Select a staff member','error');
    return;
  }
  var inquiry = (DB.inquiries || []).find(function(row){ return row.id === currentInquiryShareId; });
  var employee = DB.employees.find(function(row){ return row.id === selected.value; });
  if (!inquiry || !employee) return;
  var phone = currentInquiryShareMaskPhone ? '' : (inquiry.phone || '');
  var message = 'New Inquiry: ' + inquiry.name + ' needs ' + (inquiry.service || 'service') + ' in ' + (inquiry.area || inquiry.city || 'Ahmedabad') + '. Emergency: ' + (inquiry.rating_emergency || 5) + '/10.' + (phone ? ' Please contact: ' + phone + '.' : '') + ' — Hominal Healthcare | ' + COMPANY.phone;
  window.open(waLink(employee.phone, message), '_blank');
  recordAudit('inquiry', inquiry.id, 'share', buildStampText('Shared inquiry to staff'), { employee:getEmployeeName(employee) });
  closeModal('inqShareModal');
}

function deleteInquiry(id) {
  if (!confirm('Delete this inquiry?')) return;
  DB.inquiries = (DB.inquiries || []).filter(function(inquiry){ return inquiry.id !== id; });
  if (SB_READY) sbDelete('hh_inquiries', id);
  recordAudit('inquiry', id, 'delete', buildStampText('Deleted inquiry'), {});
  saveDB();
  renderInquiries();
}

function convertInquiry(id) {
  var inquiry = (DB.inquiries || []).find(function(row){ return row.id === id; });
  if (!inquiry) return;
  setPatMode('create');
  sv('pf_name', inquiry.name || '');
  sv('pf_phone', inquiry.phone || '');
  sv('pf_gender', inquiry.gender || '');
  sv('pf_city', inquiry.city || '');
  sv('pf_area', inquiry.area || '');
  openModal('patModal');
  toast('Review and save patient details');
}

function buildBreakdownForPartner(partnerName) {
  var items = [];
  Object.keys(DB.payoutCharges || {}).forEach(function(key){
    (DB.payoutCharges[key] || []).forEach(function(charge){
      if (charge.partner !== partnerName) return;
      var billId = key.split('_')[0];
      var serviceName = key.split('_').slice(1).join('_');
      var bill = findBillingByBillId(billId);
      var patient = bill ? DB.patients.find(function(row){ return row.id === (bill.patientId || bill.patient_id); }) : null;
      items.push({
        patientId: patient ? patient.id : '',
        patientName: patient ? patient.name : billId,
        service: serviceName,
        date: charge.date,
        term: charge.term,
        amount: parseFloat(charge.amount) || 0
      });
    });
  });
  return items;
}

function renderPayables() {
  syncRecurringServiceData();
  var container = document.getElementById('payablesBody');
  if (!container) return;
  clearElement(container);
  var partnerMap = {};
  Object.keys(DB.payoutCharges || {}).forEach(function(key){
    (DB.payoutCharges[key] || []).forEach(function(charge){
      if (!partnerMap[charge.partner]) partnerMap[charge.partner] = [];
      partnerMap[charge.partner].push(charge);
    });
  });
  var paidMap = {};
  (DB.paidTransactions || []).forEach(function(tx){
    if (!paidMap[tx.partner]) paidMap[tx.partner] = 0;
    paidMap[tx.partner] += parseFloat(tx.amount) || 0;
  });
  var names = Object.keys(partnerMap);
  if (!names.length) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">💰</div><div class="empty-title">No pending payables</div></div>';
    return;
  }
  names.forEach(function(name){
    var rows = buildBreakdownForPartner(name);
    var total = rows.reduce(function(sum, row){ return sum + row.amount; }, 0);
    var paid = paidMap[name] || 0;
    var balance = total - paid;
    if (balance <= 0) return;
    var employee = DB.employees.find(function(emp){ return getEmployeeName(emp) === name; });
    var card = createTextNodeEl('div', '', 'card');
    var header = createTextNodeEl('div', '', 'card-hdr');
    header.appendChild(createTextNodeEl('span', name + ' | Outstanding ' + formatCurrency(balance), 'card-title'));
    var headerActions = createTextNodeEl('div', '', 'td-acts');
    headerActions.appendChild(createLink('💬 WA', waLink((employee || {}).phone, 'Payment update: ' + formatCurrency(balance) + ' pending for ' + getMonthLabel(todayIso()) + '. — ' + COMPANY.brand + ' | ' + COMPANY.phone), 'wa-btn'));
    headerActions.appendChild(createButton('Payout PDF', 'btn btn-outline btn-xs', function(){ downloadPayoutPdf(name); }));
    headerActions.appendChild(createButton('Pay Partial / Full', 'btn btn-success btn-xs', function(){ openPayPartner(name, balance); }));
    header.appendChild(headerActions);
    card.appendChild(header);
    var body = createTextNodeEl('div', '', 'card-body');
    var table = document.createElement('table');
    var thead = document.createElement('thead');
    thead.innerHTML = '<tr><th>Patient Name</th><th>Service</th><th>Date</th><th>Term</th><th>Amount</th></tr>';
    table.appendChild(thead);
    var tbody = document.createElement('tbody');
    rows.forEach(function(row){
      var tr = document.createElement('tr');
      tr.appendChild(createTd(row.patientName || ''));
      tr.appendChild(createTd(row.service || ''));
      tr.appendChild(createTd(row.date || ''));
      tr.appendChild(createTd(row.term || ''));
      tr.appendChild(createTd((row.amount || 0).toFixed(2), 'fw7'));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    body.appendChild(table);
    var summary = createTextNodeEl('div', 'Total ' + formatCurrency(total) + ' | Paid ' + formatCurrency(paid) + ' | Balance ' + formatCurrency(balance), 'sm mt8');
    body.appendChild(summary);
    card.appendChild(body);
    container.appendChild(card);
  });
}

function openPayPartner(name, amount) {
  pendingPayPartner = { name:name, amount:amount };
  sv('payAmt', (parseFloat(amount) || 0).toFixed(2));
  sv('payMethod', 'Cash');
  pendingPaymentProof = null;
  updateUploadProgress('payProofMeta', 'Cash payment requires signed receipt photo.');
  var txt = document.getElementById('payConfirmTxt');
  if (txt) txt.textContent = 'Process payout for ' + name + ' (' + getMonthLabel(todayIso()) + ')';
  openModal('payModal');
}

function doPayPartner() {
  if (!pendingPayPartner) return;
  var amount = parseFloat(gv('payAmt')) || 0;
  var method = gv('payMethod') || 'Cash';
  if (!amount) {
    toast('Amount is required','error');
    return;
  }
  if (method === 'Cash' && !pendingPaymentProof) {
    toast('Cash payout requires receipt photo','error');
    return;
  }
  var next = DB.nextIds.paidtx || 61;
  DB.nextIds.paidtx = next + 1;
  var tx = {
    id: 'POR' + String(next).padStart(6, '0'),
    partner: pendingPayPartner.name,
    paidOn: fmtDate(new Date()),
    paid_on: fmtDate(new Date()),
    amount: amount,
    method: method,
    photo: pendingPaymentProof || '',
    monthLabel: getMonthLabel(todayIso())
  };
  DB.paidTransactions.unshift(tx);
  if (SB_READY) sbUpsert('hh_paid_transactions', [toSbPaidTransaction(tx)]);
  recordAudit('payout', tx.id, 'create', buildStampText('Paid payout'), { partner:tx.partner, amount:amount, method:method });
  saveDB();
  closeModal('payModal');
  toast('Payout processed');
  pendingPayPartner = null;
  renderPayables();
  renderPaidTransactions();
}

function renderPaidTransactions() {
  var tb = document.getElementById('paidTxBody');
  if (!tb) return;
  clearElement(tb);
  var list = DB.paidTransactions || [];
  if (!list.length) {
    var empty = document.createElement('tr');
    var td = createTd('', '');
    td.colSpan = 7;
    td.innerHTML = '<div class="empty-state"><div class="empty-icon">💳</div><div class="empty-title">No transactions</div></div>';
    empty.appendChild(td);
    tb.appendChild(empty);
    return;
  }
  list.forEach(function(tx, idx){
    var employee = DB.employees.find(function(emp){ return getEmployeeName(emp) === tx.partner; });
    var tr = document.createElement('tr');
    tr.appendChild(createTd(idx + 1));
    tr.appendChild(createTd(tx.id || '', 'td-id'));
    tr.appendChild(createTd(tx.partner || '', 'td-name'));
    tr.appendChild(createTd(tx.paidOn || tx.paid_on || ''));
    tr.appendChild(createTd((parseFloat(tx.amount) || 0).toFixed(2), 'fw7'));
    tr.appendChild(createTd(tx.method || ''));
    tr.appendChild(createActionCell([
      createButton('Receipt PDF', 'btn btn-outline btn-xs', function(){ downloadPayoutReceiptPdf(tx.id); }),
      createLink('💬 WA', waLink((employee || {}).phone, 'Payment of ' + formatCurrency(tx.amount) + ' processed for ' + (tx.monthLabel || getMonthLabel(todayIso())) + '. See attached receipt. — ' + COMPANY.brand + ' | ' + COMPANY.phone), 'wa-btn')
    ]));
    tb.appendChild(tr);
  });
}

function buildReportData() {
  var range = getDateRange();
  var reportType = gv('reportType') || 'patient-billing';
  if (reportType === 'patient-billing') {
    return buildPatientBillingReport(range);
  }
  if (reportType === 'employee-payout') {
    return buildEmployeePayoutReport(range);
  }
  if (reportType === 'profit-loss') {
    return buildProfitLossReport(range);
  }
  if (reportType === 'inquiry-conversion') {
    return buildInquiryConversionReport(range);
  }
  return buildAttendanceServiceReport(range);
}

function buildPatientBillingReport(range) {
  var rows = [];
  DB.patients.forEach(function(patient){
    var bill = DB.billings[patient.id];
    if (!bill) return;
    if (!dateWithinRange(patient.created, range) && !dateWithinRange(bill.created, range)) return;
    var money = getBillingFinancials(patient.id);
    rows.push({
      patient: patient.name,
      status: patient.status || 'Active',
      total: money.total,
      collected: money.advanceDisplay,
      outstanding: money.outstanding,
      deposit: money.secDep
    });
  });
  return { type:'patient-billing', title:'Patient Billing Report', rows:rows, range:range };
}

function buildEmployeePayoutReport(range) {
  var rows = [];
  DB.employees.forEach(function(employee){
    var name = getEmployeeName(employee);
    var charges = buildBreakdownForPartner(name).filter(function(item){ return dateWithinRange(item.date, range); });
    if (!charges.length) return;
    var total = charges.reduce(function(sum, item){ return sum + item.amount; }, 0);
    var paid = (DB.paidTransactions || []).filter(function(tx){
      return tx.partner === name && dateWithinRange(tx.paidOn || tx.paid_on, range);
    }).reduce(function(sum, tx){ return sum + (parseFloat(tx.amount) || 0); }, 0);
    rows.push({
      employee: name,
      month: getMonthLabel(range.from),
      totalPaid: paid,
      pending: total - paid,
      totalPayable: total
    });
  });
  return { type:'employee-payout', title:'Employee Payout Report', rows:rows, range:range };
}

function buildProfitLossReport(range) {
  var incomeRows = [];
  Object.keys(DB.receipts || {}).forEach(function(billId){
    (DB.receipts[billId] || []).forEach(function(receipt){
      if (!dateWithinRange(receipt.date, range)) return;
      incomeRows.push({ label:getMonthLabel(receipt.date), value:parseFloat(receipt.amount) || 0 });
    });
  });
  var expenseRows = [];
  (DB.paidTransactions || []).forEach(function(tx){
    if (!dateWithinRange(tx.paidOn || tx.paid_on, range)) return;
    expenseRows.push({ label:getMonthLabel(tx.paidOn || tx.paid_on), value:parseFloat(tx.amount) || 0 });
  });
  var revenue = incomeRows.reduce(function(sum, row){ return sum + row.value; }, 0);
  var expense = expenseRows.reduce(function(sum, row){ return sum + row.value; }, 0);
  var months = {};
  incomeRows.forEach(function(row){
    if (!months[row.label]) months[row.label] = { month:row.label, revenue:0, expense:0, net:0 };
    months[row.label].revenue += row.value;
  });
  expenseRows.forEach(function(row){
    if (!months[row.label]) months[row.label] = { month:row.label, revenue:0, expense:0, net:0 };
    months[row.label].expense += row.value;
  });
  Object.keys(months).forEach(function(label){
    months[label].net = months[label].revenue - months[label].expense;
  });
  return { type:'profit-loss', title:'Profit & Loss Statement', revenue:revenue, expense:expense, net:revenue - expense, rows:Object.keys(months).map(function(label){ return months[label]; }), range:range };
}

function buildInquiryConversionReport(range) {
  var sourceMap = {};
  (DB.inquiries || []).forEach(function(inquiry){
    if (!dateWithinRange(inquiry.created, range)) return;
    var source = inquiry.source || 'Unknown';
    if (!sourceMap[source]) sourceMap[source] = { source:source, total:0, converted:0, hot:0, warm:0, cold:0 };
    sourceMap[source].total += 1;
    if (inquiry.status === 'Converted') sourceMap[source].converted += 1;
    if (inquiry.potential === 'Hot') sourceMap[source].hot += 1;
    else if (inquiry.potential === 'Cold') sourceMap[source].cold += 1;
    else sourceMap[source].warm += 1;
  });
  Object.keys(sourceMap).forEach(function(source){
    var row = sourceMap[source];
    row.rate = row.total ? ((row.converted / row.total) * 100).toFixed(1) + '%' : '0%';
  });
  return { type:'inquiry-conversion', title:'Inquiry Conversion Report', rows:Object.keys(sourceMap).map(function(key){ return sourceMap[key]; }), range:range };
}

function buildAttendanceServiceReport(range) {
  var employeeMap = {};
  Object.keys(DB.svcEntries || {}).forEach(function(key){
    (DB.svcEntries[key] || []).forEach(function(entry){
      if (!dateWithinRange(entry.date, range)) return;
      var partner = entry.partner || 'Unassigned';
      if (!employeeMap[partner]) employeeMap[partner] = { employee:partner, days:0, absent:0, patients:{} };
      employeeMap[partner].days += parseFloat(entry.count) || 0;
      employeeMap[partner].absent += parseFloat(entry.absent) || 0;
      var billId = key.split('_')[0];
      var bill = findBillingByBillId(billId);
      var patientId = bill ? (bill.patientId || bill.patient_id) : '';
      if (patientId) employeeMap[partner].patients[patientId] = true;
    });
  });
  var rows = Object.keys(employeeMap).map(function(name){
    return {
      employee: name,
      days: employeeMap[name].days,
      absent: employeeMap[name].absent,
      patients: Object.keys(employeeMap[name].patients).length
    };
  });
  return { type:'attendance-service', title:'Attendance & Service Report', rows:rows, range:range };
}

function renderReportTable(headers, rows) {
  var table = document.createElement('table');
  var thead = document.createElement('thead');
  var headRow = document.createElement('tr');
  headers.forEach(function(header){
    headRow.appendChild(createTextNodeEl('th', header, ''));
  });
  thead.appendChild(headRow);
  table.appendChild(thead);
  var tbody = document.createElement('tbody');
  rows.forEach(function(row){
    var tr = document.createElement('tr');
    row.forEach(function(cell){
      tr.appendChild(createTd(cell));
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  return table;
}

function renderReports() {
  var body = document.getElementById('reportBody');
  var title = document.getElementById('reportTitle');
  if (!body || !title) return;
  clearElement(body);
  var report = buildReportData();
  title.textContent = report.title;
  if (report.type === 'patient-billing') {
    body.appendChild(renderReportTable(
      ['Patient','Status','Total Bill','Collected','Outstanding','Security Deposit'],
      report.rows.map(function(row){ return [row.patient, row.status, formatCurrency(row.total), formatCurrency(row.collected), formatCurrency(row.outstanding), formatCurrency(row.deposit)]; })
    ));
  } else if (report.type === 'employee-payout') {
    body.appendChild(renderReportTable(
      ['Employee','Month','Total Payable','Paid','Pending'],
      report.rows.map(function(row){ return [row.employee, row.month, formatCurrency(row.totalPayable), formatCurrency(row.totalPaid), formatCurrency(row.pending)]; })
    ));
  } else if (report.type === 'profit-loss') {
    body.appendChild(renderReportTable(
      ['Month','Revenue','Expense','Net'],
      report.rows.map(function(row){ return [row.month, formatCurrency(row.revenue), formatCurrency(row.expense), formatCurrency(row.net)]; })
    ));
    var chartWrap = createTextNodeEl('div', '', 'bar-chart');
    var max = Math.max.apply(null, report.rows.map(function(row){ return Math.max(row.revenue, row.expense, Math.abs(row.net)); }).concat([1]));
    report.rows.forEach(function(row){
      var bar = createTextNodeEl('div', '', 'bar');
      bar.style.height = Math.max(24, (Math.abs(row.net) / max) * 180) + 'px';
      bar.appendChild(createTextNodeEl('div', formatCurrency(row.net), 'bar-value'));
      bar.appendChild(createTextNodeEl('div', row.month, 'bar-label'));
      chartWrap.appendChild(bar);
    });
    body.appendChild(chartWrap);
    body.appendChild(createTextNodeEl('div', 'Revenue ' + formatCurrency(report.revenue) + ' | Expense ' + formatCurrency(report.expense) + ' | Net ' + formatCurrency(report.net), 'sm mt12'));
  } else if (report.type === 'inquiry-conversion') {
    body.appendChild(renderReportTable(
      ['Source','Total Inquiries','Converted','Conversion Rate','Hot','Warm','Cold'],
      report.rows.map(function(row){ return [row.source, row.total, row.converted, row.rate, row.hot, row.warm, row.cold]; })
    ));
  } else {
    body.appendChild(renderReportTable(
      ['Employee','Days Worked','Absent Days','Patients Served'],
      report.rows.map(function(row){ return [row.employee, row.days, row.absent, row.patients]; })
    ));
  }
}

function toggleReportRangeInputs() {
  var mode = gv('reportRangeMode');
  var from = document.getElementById('reportFrom');
  var to = document.getElementById('reportTo');
  var hide = mode !== 'custom';
  if (from) from.style.display = hide ? 'none' : 'inline-flex';
  if (to) to.style.display = hide ? 'none' : 'inline-flex';
  renderReports();
}

function exportReportCsv() {
  var report = buildReportData();
  var rows = [];
  if (report.type === 'patient-billing') rows = [['Patient','Status','Total Bill','Collected','Outstanding','Security Deposit']].concat(report.rows.map(function(row){ return [row.patient, row.status, row.total, row.collected, row.outstanding, row.deposit]; }));
  else if (report.type === 'employee-payout') rows = [['Employee','Month','Total Payable','Paid','Pending']].concat(report.rows.map(function(row){ return [row.employee, row.month, row.totalPayable, row.totalPaid, row.pending]; }));
  else if (report.type === 'profit-loss') rows = [['Month','Revenue','Expense','Net']].concat(report.rows.map(function(row){ return [row.month, row.revenue, row.expense, row.net]; }));
  else if (report.type === 'inquiry-conversion') rows = [['Source','Total','Converted','Rate','Hot','Warm','Cold']].concat(report.rows.map(function(row){ return [row.source, row.total, row.converted, row.rate, row.hot, row.warm, row.cold]; }));
  else rows = [['Employee','Days Worked','Absent Days','Patients Served']].concat(report.rows.map(function(row){ return [row.employee, row.days, row.absent, row.patients]; }));
  var csv = rows.map(function(row){
    return row.map(function(cell){ return '"' + String(cell).replace(/"/g, '""') + '"'; }).join(',');
  }).join('\n');
  var a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,\uFEFF' + encodeURIComponent(csv);
  a.download = 'hominal_report_' + report.type + '_' + todayIso() + '.csv';
  a.click();
}

function printCurrentReport() {
  var report = buildReportData();
  var html = [];
  html.push('<div class="box"><div class="k">Date Range</div><div class="v">' + safeText(report.range.from + ' to ' + report.range.to) + '</div></div>');
  if (report.type === 'profit-loss') {
    html.push('<div class="box" style="margin-top:12px"><div class="v">Revenue: ' + formatCurrency(report.revenue) + ' | Expense: ' + formatCurrency(report.expense) + ' | Net: ' + formatCurrency(report.net) + '</div></div>');
  }
  var tableRows = [];
  var headers = [];
  if (report.type === 'patient-billing') {
    headers = ['Patient','Status','Total Bill','Collected','Outstanding','Security Deposit'];
    tableRows = report.rows.map(function(row){ return [row.patient,row.status,formatCurrency(row.total),formatCurrency(row.collected),formatCurrency(row.outstanding),formatCurrency(row.deposit)]; });
  } else if (report.type === 'employee-payout') {
    headers = ['Employee','Month','Total Payable','Paid','Pending'];
    tableRows = report.rows.map(function(row){ return [row.employee,row.month,formatCurrency(row.totalPayable),formatCurrency(row.totalPaid),formatCurrency(row.pending)]; });
  } else if (report.type === 'profit-loss') {
    headers = ['Month','Revenue','Expense','Net'];
    tableRows = report.rows.map(function(row){ return [row.month,formatCurrency(row.revenue),formatCurrency(row.expense),formatCurrency(row.net)]; });
  } else if (report.type === 'inquiry-conversion') {
    headers = ['Source','Total Inquiries','Converted','Conversion Rate','Hot','Warm','Cold'];
    tableRows = report.rows.map(function(row){ return [row.source,row.total,row.converted,row.rate,row.hot,row.warm,row.cold]; });
  } else {
    headers = ['Employee','Days Worked','Absent Days','Patients Served'];
    tableRows = report.rows.map(function(row){ return [row.employee,row.days,row.absent,row.patients]; });
  }
  html.push('<table><thead><tr>' + headers.map(function(header){ return '<th>' + safeText(header) + '</th>'; }).join('') + '</tr></thead><tbody>' + tableRows.map(function(row){ return '<tr>' + row.map(function(cell){ return '<td>' + safeText(cell) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table>');
  openPrintWindow(report.title, report.range.from + ' to ' + report.range.to, html.join(''), buildStampText('Generated report'));
}

function downloadEmployeePdf(empId) {
  var employee = DB.employees.find(function(row){ return row.id === empId; });
  if (!employee) {
    toast('Employee not found','error');
    return;
  }
  var html = [];
  html.push(buildInfoGrid([
    { key:'Employee ID', value:employee.id },
    { key:'Name', value:getEmployeeName(employee) },
    { key:'Type', value:employee.emp_type || employee.etype || '-' },
    { key:'Designation', value:employee.desig || '-' },
    { key:'Department', value:employee.dept || '-' },
    { key:'Shift', value:employee.shift || '-' },
    { key:'Education', value:employee.edu || '-' },
    { key:'Job Profile', value:employee.skills || '-' },
    { key:'Area', value:employee.area || '-' },
    { key:'Phone', value:employee.phone || '-' },
    { key:'Score', value:(employee.scoreTotal || calculateEmployeeScore(employee)) + ' / 10' },
    { key:'Created', value:employee.created || '-' }
  ]));
  html.push('<table><thead><tr><th>Document</th><th>Category</th><th>Size</th></tr></thead><tbody>' + (employee.docs || []).map(function(doc){
    return '<tr><td>' + safeText(doc.name || '') + '</td><td>' + safeText(doc.category || 'Document') + '</td><td>' + safeText(formatFileSize(doc.size || 0)) + '</td></tr>';
  }).join('') + '</tbody></table>');
  openPrintWindow('Employee Profile', getEmployeeName(employee), html.join(''), buildStampText('Created employee PDF'));
}

function downloadEmployeesPdf() {
  var rows = DB.employees.map(function(employee){
    return '<tr><td>' + safeText(employee.id || '') + '</td><td>' + safeText(getEmployeeName(employee)) + '</td><td>' + safeText(employee.emp_type || '') + '</td><td>' + safeText(employee.dept || '') + '</td><td>' + safeText(employee.phone || '') + '</td><td>' + safeText(employee.area || '') + '</td></tr>';
  }).join('');
  openPrintWindow('Employee Directory', 'All employees', '<table><thead><tr><th>ID</th><th>Name</th><th>Type</th><th>Department</th><th>Phone</th><th>Area</th></tr></thead><tbody>' + rows + '</tbody></table>', buildStampText('Created employee directory PDF'));
}

function buildBillTableRows(money) {
  return money.services.map(function(item){
    var entries = item.entries || [];
    var first = entries[0] ? entries[0].date : '';
    var last = entries[entries.length - 1] ? entries[entries.length - 1].date : '';
    var days = entries.length;
    var people = entries.reduce(function(sum, entry){ return sum + (parseFloat(entry.count) || 0) - (parseFloat(entry.absent) || 0); }, 0);
    return '<tr><td>' + safeText(item.service) + '</td><td>' + safeText(first + ' to ' + last) + '</td><td>' + days + '</td><td>' + people + '</td><td>' + formatCurrency(item.total) + '</td></tr>';
  }).join('');
}

function downloadBillPdf(patId) {
  var patient = DB.patients.find(function(row){ return row.id === patId; });
  var money = getBillingFinancials(patId);
  var bill = money.bill || {};
  if (!patient || !bill.id) {
    toast('Billing not found','error');
    return;
  }
  var closeAudit = getPatientLatestCloseAudit(patId);
  var html = [];
  html.push('<div class="meta">'
    + '<div class="box"><div class="k">Patient Info</div><div class="v"><div style="font-family:monospace;font-size:24px;letter-spacing:3px;color:#cbd5e1;margin-bottom:8px">|||||' + safeText(patient.id) + '|||||</div>'
    + 'Name: ' + safeText(patient.name) + '<br>Patient ID: ' + safeText(patient.id) + '<br>Phone: ' + safeText(patient.phone || '-') + '<br>Status: ' + safeText(patient.status || 'Active') + '</div></div>'
    + '<div class="box"><div class="k">Bill Info</div><div class="v">Bill No: ' + safeText(bill.id || '') + '<br>Generated: ' + safeText(fmtDate(new Date())) + '<br>Type: ' + safeText(bill.status === 'Closed' ? 'Final Bill' : 'Provisional Bill') + (closeAudit && closeAudit.meta && closeAudit.meta.reason ? '<br>Close Reason: ' + safeText(closeAudit.meta.reason + (closeAudit.meta.other ? ' - ' + closeAudit.meta.other : '')) : '') + '</div></div>'
    + '</div>');
  html.push('<table><thead><tr><th>Service</th><th>Duration</th><th>Total Days</th><th>Total People</th><th>Total</th></tr></thead><tbody>' + buildBillTableRows(money) + '<tr><td colspan="4"><strong>Security Deposit (Credit)</strong></td><td>' + formatCurrency(money.secDep) + '</td></tr><tr><td colspan="4"><strong>Monthly Subtotal</strong></td><td>' + formatCurrency(money.total) + '</td></tr><tr><td colspan="4"><strong>Advance / Credit Considered</strong></td><td>' + formatCurrency(money.advanceDisplay) + '</td></tr><tr><td colspan="4"><strong>Outstanding</strong></td><td>' + formatCurrency(money.outstanding) + '</td></tr></tbody></table>');
  openPrintWindow(bill.status === 'Closed' ? 'Final Bill' : 'Provisional Bill', patient.name, html.join(''), buildStampText('Created bill PDF'), bill.status === 'Closed' ? 'FINAL BILL' : 'PROVISIONAL BILL');
}

function downloadReceiptsPdf(patId, receiptId) {
  var patient = DB.patients.find(function(row){ return row.id === patId; }) || {};
  var bill = DB.billings[patId] || {};
  var receipts = ((DB.receipts[bill.id] || []).filter(function(receipt){
    return !receiptId || receipt.id === receiptId;
  }));
  if (!receipts.length) {
    toast('No receipts found','error');
    return;
  }
  var rows = receipts.map(function(receipt){
    var audit = getLatestAudit('receipt', receipt.id, 'create');
    return '<tr><td>' + safeText(receipt.id) + '</td><td>' + safeText(receipt.date) + '</td><td>' + safeText(receipt.type) + '</td><td>' + formatCurrency(receipt.amount) + '</td><td>' + safeText(receipt.method) + '</td><td>' + safeText(receipt.ref || '-') + '</td><td>' + safeText(receipt.remarks || '-') + '<br><span style="font-size:10px;color:#475569">' + safeText(audit ? audit.stampText : '') + '</span></td></tr>';
  }).join('');
  var html = '<div class="box"><div class="v">Patient: ' + safeText(patient.name || '') + '<br>Bill No: ' + safeText(bill.id || '') + '<br>Phone: ' + safeText(patient.phone || '') + '</div></div>'
    + '<table><thead><tr><th>Receipt ID</th><th>Date</th><th>Type</th><th>Amount</th><th>Method</th><th>Reference</th><th>Remarks</th></tr></thead><tbody>' + rows + '</tbody></table>';
  openPrintWindow('Receipt Statement', patient.name || '', html, buildStampText('Created receipt PDF'));
}

function downloadInquiryPdf(inquiryId, includePhone) {
  var inquiry = (DB.inquiries || []).find(function(row){ return row.id === inquiryId; });
  if (!inquiry) {
    toast('Inquiry not found','error');
    return;
  }
  var html = [];
  html.push('<div class="meta"><div class="box"><div class="k">Inquiry Info</div><div class="v">Patient Name: ' + safeText(inquiry.name) + '<br>Service Required: ' + safeText(inquiry.service || '-') + '<br>Source: ' + safeText(inquiry.source || '-') + (includePhone ? '<br>Mobile: ' + safeText(inquiry.phone || '-') : '') + '<br>Area: ' + safeText(inquiry.area || inquiry.city || '-') + '</div></div>'
    + '<div class="box"><div class="k">Ratings</div><div class="v">Emergency: ' + safeText(inquiry.rating_emergency || 5) + '/10<br>Flexibility: ' + safeText(inquiry.rating_flexibility || 5) + '/10<br>Overall Priority: ' + safeText(inquiry.rating_overall || 5) + '/10<br>Potential: ' + safeText(inquiry.potential || 'Warm') + '</div></div></div>');
  html.push('<div class="box"><div class="k">Notes</div><div class="v">' + safeText(inquiry.notes || '-') + '</div></div>');
  openPrintWindow('Inquiry Sheet', includePhone ? 'With Mobile Number' : 'Without Mobile Number', html.join(''), buildStampText('Created inquiry PDF'));
}

function downloadPayoutPdf(partnerName) {
  var rows = buildBreakdownForPartner(partnerName);
  var total = rows.reduce(function(sum, row){ return sum + row.amount; }, 0);
  var html = '<div class="meta"><div class="box"><div class="k">Employee</div><div class="v">' + safeText(partnerName) + '</div></div><div class="box"><div class="k">Month</div><div class="v">' + safeText(getMonthLabel(todayIso())) + '</div></div></div>'
    + '<table><thead><tr><th>Patient Name</th><th>Service</th><th>Days</th><th>Rate/Day</th><th>Amount</th></tr></thead><tbody>' + rows.map(function(row){
      return '<tr><td>' + safeText(row.patientName) + '</td><td>' + safeText(row.service) + '</td><td>1</td><td>' + formatCurrency(row.amount) + '</td><td>' + formatCurrency(row.amount) + '</td></tr>';
    }).join('') + '<tr><td colspan="4"><strong>Total Payable</strong></td><td>' + formatCurrency(total) + '</td></tr></tbody></table>';
  openPrintWindow('Payout Statement', partnerName, html, buildStampText('Created payout PDF'));
}

function downloadPayoutReceiptPdf(txId) {
  var tx = (DB.paidTransactions || []).find(function(row){ return row.id === txId; });
  if (!tx) {
    toast('Payout transaction not found','error');
    return;
  }
  var html = '<div class="meta"><div class="box"><div class="k">Employee</div><div class="v">' + safeText(tx.partner) + '</div></div><div class="box"><div class="k">Payment</div><div class="v">' + safeText(tx.paidOn || tx.paid_on || '') + '<br>' + safeText(tx.method || '') + '<br>' + formatCurrency(tx.amount) + '</div></div></div>';
  if (tx.photo) {
    html += '<div class="box"><div class="k">Payment Proof</div><div class="v"><img src="' + tx.photo + '" style="max-width:260px;max-height:220px;border-radius:8px;"></div></div>';
  }
  openPrintWindow('Payout Receipt', tx.partner, html, buildStampText('Processed payout receipt'));
}

function patchToSbMappings() {
  var baseEmployee = toSbEmployee;
  toSbEmployee = function(employee) {
    var row = baseEmployee(employee);
    row.score_experience = employee.scoreExperience || employee.score_experience || '';
    row.score_behaviour = employee.scoreBehaviour || employee.score_behaviour || '';
    row.score_testimonial = employee.scoreTestimonial || employee.score_testimonial || '';
    row.score_total = employee.scoreTotal || employee.score_total || '';
    return row;
  };
  var basePatient = toSbPatient;
  toSbPatient = function(patient) {
    var row = basePatient(patient);
    row.status_reason = patient.status_reason || '';
    row.status_reason_other = patient.status_reason_other || '';
    return row;
  };
  var baseBilling = toSbBilling;
  toSbBilling = function(billing, patientId) {
    var row = baseBilling(billing, patientId);
    row.close_reason = billing.close_reason || '';
    row.close_reason_other = billing.close_reason_other || '';
    return row;
  };
}

function wrapLoadDb() {
  var original = loadDB;
  loadDB = async function() {
    await original();
    ensureExtraState();
    await loadExtraSupabaseStores();
    saveDB();
  };
}

function wrapDoLogin() {
  var original = doLogin;
  doLogin = function() {
    original();
    setTimeout(function(){
      var session = getSession();
      if (session && session.user) recordAudit('session', session.user.id || 'user', 'login', buildStampText('Logged in'), {});
    }, 50);
  };
}

function wrapShowApp() {
  var original = showApp;
  showApp = function(user) {
    original(user);
    renderSettingsPreview();
  };
}

function wrapNav() {
  var original = nav;
  nav = function(page) {
    original(page);
    if (page === 'reports') renderReports();
    if (page === 'settings') renderSettingsPreview();
  };
}

function initializeEnhancements() {
  ensureExtraState();
  patchToSbMappings();
  wrapLoadDb();
  wrapDoLogin();
  wrapShowApp();
  wrapNav();
  EMP_AREA_LIST = getAreaOptions();
  ensureSettingsAndReportsDom();
  patchEmployeeUi();
  patchPatientUi();
  patchInquiryUi();
  patchBillingUi();
  patchPayoutUi();
  patchStaticIds();
  decorateConfirmButtons();
  bindStaticActions();
  toggleReportRangeInputs();
  renderSettingsPreview();
  updateEmployeeScoreDisplay();
}

initializeEnhancements();
})();
