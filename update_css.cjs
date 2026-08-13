const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'app/globals.css');
let content = fs.readFileSync(file, 'utf8');

const newCSS = `/* Recurring Transactions View Redesign */
.recurring-main-card {
  background: var(--white);
  border-radius: 28px;
  padding: 32px;
  border: 1px solid var(--border-light);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.02);
  position: relative;
  min-height: calc(100vh - 120px);
  display: flex;
  flex-direction: column;
}

/* Recurring Stats Top Bar */
.recurring-stats {
  display: flex;
  gap: 16px;
  margin-bottom: 24px;
}
.recurring-stat-box {
  flex: 1;
  background: #f8faf9;
  border: 1px solid var(--border-light);
  border-radius: 16px;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.recurring-stat-box.warning {
  background: #fff8e6;
  border-color: #fde68a;
}
.recurring-stat-box.danger {
  background: #fff1f2;
  border-color: #fecdd3;
}
.stat-label {
  font-size: 13px;
  color: var(--text-subtle);
  font-weight: 600;
}
.stat-value {
  font-size: 24px;
  color: var(--text-dark);
  font-weight: 800;
}

/* Toolbar & Filters */
.recurring-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--border-light);
}
.recurring-filters {
  display: flex;
  gap: 12px;
}
.recurring-filters select {
  padding: 8px 14px;
  border-radius: 12px;
  border: 1px solid var(--border-input);
  background: #ffffff;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-dark);
  outline: none;
  cursor: pointer;
}
.recurring-create-btn {
  height: 42px;
  padding: 0 20px;
  border: 0;
  background: var(--sidebar-bg);
  color: #ffffff;
  border-radius: 12px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: 6px;
  box-shadow: 0 4px 14px rgba(21, 29, 31, 0.2);
  transition: all 0.2s ease;
}
.recurring-create-btn:hover {
  background: #232e31;
  transform: translateY(-1px);
}
.recurring-create-btn b {
  color: var(--lime-accent);
  font-size: 16px;
}

/* Recurring Cards Grid */
.recurring-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 20px;
}
.recurring-card {
  background: #ffffff;
  border: 1px solid var(--border-light);
  border-radius: 20px;
  padding: 22px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.02);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  transition: all 0.2s ease;
}
.recurring-card:hover {
  border-color: #ccd7d2;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.05);
}
.recurring-card.due {
  border-color: #f59e0b;
  box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.15);
}
.recurring-card.paused {
  opacity: 0.65;
  background: #fcfcfc;
}
.recurring-card.insufficient {
  border-color: #ef4444;
  background: #fff1f2;
}

.recurring-card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 14px;
}
.recurring-card-type-icon {
  width: 38px;
  height: 38px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  font-size: 16px;
  font-weight: 800;
}
.recurring-card-type-icon.income {
  background: var(--income-green-bg);
  color: var(--income-green-text);
}
.recurring-card-type-icon.expense {
  background: var(--expense-red-bg);
  color: var(--expense-red-text);
}
.recurring-card-info {
  flex: 1;
  margin: 0 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.recurring-card-info b {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-dark);
}
.recurring-card-info small {
  color: var(--text-subtle);
  font-size: 12px;
}
.recurring-status-badge {
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
}
.recurring-status-badge.active {
  background: var(--income-green-bg);
  color: var(--income-green-text);
}
.recurring-status-badge.paused {
  background: #e2e8f0;
  color: #64748b;
}

.recurring-card-amount {
  margin: 12px 0 6px;
  font-size: 24px;
  font-weight: 800;
  color: var(--text-dark);
  display: flex;
  align-items: center;
  gap: 8px;
}
.est-badge {
  font-size: 10px;
  padding: 2px 6px;
  background: #f1f5f9;
  border-radius: 4px;
  color: #64748b;
  font-weight: 600;
}
.recurring-card-next {
  color: var(--text-subtle);
  font-size: 12px;
  margin-bottom: 14px;
}
.recurring-card-next b {
  color: var(--text-dark);
}
.danger-text {
  color: #ef4444 !important;
}

.recurring-card-tags {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid #f0f4f2;
  margin-bottom: 16px;
}
.recurring-tag {
  background: #f0f4f2;
  color: #4a575a;
  padding: 3px 10px;
  border-radius: 8px;
  font-size: 11px;
  font-weight: 600;
}

.recurring-card-footer {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.insufficient-warning {
  color: #b91c1c;
  background: #fee2e2;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: 6px;
}
.recurring-due-btn {
  width: 100%;
  height: 38px;
  border-radius: 10px;
  background: var(--sidebar-bg);
  color: #ffffff;
  border: 0;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}
.recurring-due-btn.danger {
  background: #ef4444;
}
.recurring-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-start;
}
.recurring-actions button {
  background: transparent;
  border: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-subtle);
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
}
.recurring-actions button:hover {
  background: #f1f5f9;
  color: var(--text-dark);
}`;

const oldCSSRegex = /\/\* Recurring Transactions View Redesign \*\/.*?(?=\/\* Empty State Illustration for Recurring \*\/)/s;
content = content.replace(oldCSSRegex, newCSS + "\n\n");

fs.writeFileSync(file, content, 'utf8');
console.log("Updated globals.css successfully!");
