# O_Template.xlsx — Master Reporting & Calculation Engine

> **Quick Summary:**  
> `O_Template.xlsx` is the central **Excel Calculation & PDF Generation Engine** for the ProAffluence Client Reporting Portal.  
> The backend prepares and writes transaction and valuation data into this template, which then recalculates all portfolio performance formulas (XIRR, category allocations, benchmark comparisons) and generates the final client PDF report (**FY Annual Dashboard**).

---

## 1. Why Does This Template Exist?

In the ProAffluence platform, reporting operates on a **hybrid architecture**:

```
[Web Portal & PostgreSQL] 
   ├── Master Cashflows (Trades, Buy, Sell, SIPs)
   └── Closing Balances (Monthly Portfolio Values)
               │
               ▼ (Backend Data Preparation & Validation)
      [O_Template.xlsx]
   ├── Calculates XIRR & Absolute Returns
   ├── Computes Category & Equity/Debt Allocations
   └── Computes Benchmark Weighted Comparison (Nifty 50 TRI)
               │
               ▼ (Excel PDF Export Engine)
  [FY Annual Dashboard PDF] ──► Emailed to Group Heads
```

- **Database (PostgreSQL)** is the *system of record* (clients, transactions, logins, audit logs).
- **`O_Template.xlsx`** is the *calculation & layout engine* to ensure client reports match ProAffluence's existing legacy calculation models and visual formatting without needing to re-engineer complex multi-sheet Excel math from scratch.

---

## 2. Structure: The 12 Sheets Explained

| Sheet Name | Type | Purpose |
| :--- | :--- | :--- |
| **`Master Cashflows`** | **Core Input** | The transaction ledger. Contains client transactions: Date, Type, Category, Sub-Category, Amount, New Investments, Redemptions, etc. Populated via portal forms or broker Excel uploads. |
| **`Closing Balances`** | **Core Input** | Monthly valuation/NAV records entered by operations staff. |
| **`DashData`** | **Staging** | Intermediate staging data prepared by the backend to feed the dashboards and summary cards. |
| **`IRR Calculated`** | **Calculation** | Computes internal rates of return (`XIRR_Val`) and absolute returns (`AR_Val`). |
| **`AddtnlInfo`** | **Helper** | Period tags, date helpers, and client header mapping (Group Head, Family Member, Date filters). |
| **`Category Breakup Master`** | **Calculation** | Classifies holdings into PMS, MF, Stocks, Debt, Equity, etc., and computes percentage weights. |
| **`IndicesData`** | **Data Feed** | Benchmark historical values (Nifty 50 TRI, Sensex, BSE 500) mapped to client cashflow dates. |
| **`Indices Comparison`** | **Analytics** | Analyzes portfolio performance vs market indices over time. |
| **`FY Annual Dashboard`** | **Client PDF Report** | **The main deliverable.** Visual dashboard with annual summaries, charts, allocation movements, and returns. Exported to password-protected PDF. |
| **`CY Annual Dashboard`** | **Internal Report** | Calendar year view of the dashboard (used internally). |
| **`FY Quaterly Dashboard`** | **Internal Report** | Quarterly breakdown view (used internally). |
| **`Monthly Dashboard`** | **Internal Report** | Monthly breakdown view (used internally). |

---

## 3. Core Business & Calculation Rules

1. **XIRR vs. Absolute Return (`AR_Val`) Rule**:
   - **≥ 12 Months:** Evaluated using **XIRR** (`XIRR_Val`).
   - **< 12 Months:** Evaluated using **Point-to-Point / Absolute Return** (`AR_Val`).
   - The template contains a dynamic display switch between the two.

2. **Asset Allocation Split**:
   - Groups portfolio into **Equity** vs **Debt**.
   - **Hybrid Funds:** Automatically split as **50% Equity / 50% Debt** (unless explicitly overridden).

3. **Benchmark Matching**:
   - Primary benchmark: **Nifty 50 TRI** (Total Return Index), with Sensex and BSE 500 as secondary comparisons.
   - Index returns are weighted against the client's actual cashflow dates.

---

## 4. Key Columns in `Master Cashflows`

When importing broker sheets or submitting transactions through the portal, data maps to:
- `Sr_No`
- `Transaction_Date`
- `Transaction_Type` (e.g., Purchase, Redemption, Dividend)
- `Category` (e.g., Mutual Funds, PMS, Direct Equity, Fixed Income)
- `Sub_Category`
- `Amounts`
- `New_Investments`
- `Profit_Loss`
- `Client_Owner` / `Group_Head_Name` / `Family_Member_Name`

---

## 5. Technical Note About the File

- **Original Format:** The file was originally created as an `.xlsb` (Excel Binary Workbook) with embedded VBA macros (`vbaProject.bin` containing PDF export helpers like `ExportAsFixedFormat`).
- **File Size:** ~3.2 MB.
- **Handling in Code:** Because it uses binary Excel structures, Node.js/Python libraries should read/write it using tools supporting binary OpenXML/XLSB or automation engines (e.g., LibreOffice / Excel COM / headless spreadsheet runners).
