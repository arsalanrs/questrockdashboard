/**
 * Shape CRM user-assignment department fields (CRM 20931).
 * QuestRock often assigns inbound leads to depursLi before depursLo.
 * Priority for primary dashboard LO: LO → Interviewer → Processor → Closer.
 */
export type ShapeAssignmentDept = {
  apiKey: string;
  idColumn: string;
  displayKeys: string[];
};

export const SHAPE_ASSIGNMENT_DEPT_FIELDS: ShapeAssignmentDept[] = [
  {
    apiKey: "depursLo",
    idColumn: "Shape Depurs LO Id",
    displayKeys: ["LOA User Name", "Loan Officer User Name", "loanOfficerUserName"],
  },
  {
    apiKey: "depursLi",
    idColumn: "Shape Depurs LI Id",
    displayKeys: ["Loan Interviewer User Name", "LI User Name"],
  },
  {
    apiKey: "depursLp",
    idColumn: "Shape Depurs LP Id",
    displayKeys: ["Loan Processor User Name", "LP User Name"],
  },
  {
    apiKey: "depursPo",
    idColumn: "Shape Depurs PO Id",
    displayKeys: ["Processor User Name", "PO User Name"],
  },
  {
    apiKey: "depursCl",
    idColumn: "Shape Depurs CL Id",
    displayKeys: ["Closer User Name", "CL User Name"],
  },
];

/** API keys to request in bulk export (plus display-name variants in fields.ts). */
export const SHAPE_ASSIGNMENT_API_KEYS = SHAPE_ASSIGNMENT_DEPT_FIELDS.map((d) => d.apiKey);

export const SHAPE_ASSIGNMENT_ID_COLUMNS = SHAPE_ASSIGNMENT_DEPT_FIELDS.map((d) => d.idColumn);
