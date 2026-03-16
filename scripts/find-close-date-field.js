/**
 * Fetches a known closed loan (Haiden Goggin, record 39069) and tries
 * every plausible close-date field name to find what Shape returns it as.
 *
 * Usage: node scripts/find-close-date-field.js
 */
const path = require("path"), fs = require("fs");
function loadEnv() {
  for (const line of fs.readFileSync(path.join(__dirname,"../.env.local"),"utf8").split("\n")) {
    const t=line.trim(); if(!t||t.startsWith("#")) continue;
    const eq=t.indexOf("="); if(eq===-1) continue;
    const k=t.slice(0,eq).trim(), v=t.slice(eq+1).trim();
    if(k&&!process.env[k]) process.env[k]=v;
  }
}

async function go(fields, label) {
  const apiKey=process.env.SHAPE_API_KEY.trim(), crmId=process.env.SHAPE_CRM_ID?.trim()||"20931";
  const res=await fetch(`https://secure-api.setshape.com/api/leads/bulk/export/${crmId}`,{
    method:"POST",
    headers:{Authorization:apiKey,"Content-Type":"application/json"},
    body:JSON.stringify({
      pageNumber:1, pageSize:5,
      createdDateRange:{from:"2025-12-01",to:"2026-03-16"},
      fields,
      filters:[{field:"mstrstatus1",operator:"in",value:["Closed","Funded","Purchased"]}]
    })
  });
  const j=await res.json();
  const records=Object.values(j.data||{});
  console.log(`\n── ${label} (${records.length} records) ──`);
  for(const r of records) {
    const interesting=Object.entries(r).filter(([k,v])=>v!==null&&v!==undefined&&String(v).trim()!=""&&k!=="First Name"&&k!=="Last Name"&&k!=="Lead ID");
    if(interesting.length) console.log(" ",[...interesting.map(([k,v])=>`${k}=${JSON.stringify(v)}`)].join("  |  "));
  }
}

async function main() {
  loadEnv();

  // Batch 1 — trk* variants
  await go(["leadid","firstname","lastname","mstrstatus1","LoanAmount",
    "trkDateClosed","trkClose","trkClosed","trkClosedDate","trkClosing","trkClosingDate",
    "trkFunded","trkFundedDate","trkDateFunded","trkPurchased","trkDatePurchased",
    "trkSettle","trkSettleDate","trkSettlementDate","trkDisburse","trkDisbursementDate",
    "trkNoteDate","trkRecordDate","trkRecordingDate","trkWireDate",
  ], "Batch 1 — trk* close variants");

  // Batch 2 — non-trk variants
  await go(["leadid","firstname","lastname","mstrstatus1",
    "closeDate","closedDate","closingDate","closingdate","dateClose","dateClosed",
    "fundedDate","fundDate","purchasedDate","settlementDate","disbursementDate",
    "date_closed","date_funded","close_date","funding_date",
    "ClearToCloseDate","ctcDate","clearToClose",
  ], "Batch 2 — plain close date variants");

  // Batch 3 — request ALL trk fields to see which ones Shape knows
  await go(["leadid","firstname","lastname","mstrstatus1",
    "trk1","trk2","trk3","trk4","trk5","trk6","trk7","trk8","trk9","trk10",
    "trkDate1","trkDate2","trkDate3","trkDate4","trkDate5","trkDate6","trkDate7","trkDate8",
    "trkApplicationCompleted","trkCreditReportRequest","trkAppraisalRequest",
    "trkApprovalDate","trkCtcDate","trkFundDate","trkCloseDate",
  ], "Batch 3 — numbered trk fields");
}
main().catch(e=>{console.error(e);process.exit(1);});
