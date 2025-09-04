import express from "express";
import multer from "multer";
import xlsx from "xlsx";
import { uploadComboSkuExcel } from "../controllers/comboSkuController.js";

const router = express.Router();
const upload = multer({ dest: "uploads/" });

// 1️⃣ Upload route
router.post("/upload", upload.single("file"), uploadComboSkuExcel);

// 2️⃣ Dynamic template route
router.get("/template", (req, res) => {
  // Create headers dynamically
  const headers = ["Mapping SKU Code"];
  for (let i = 1; i <= 10; i++) {
    headers.push(`SKU ${i}`, `Quantity ${i}`);
  }

  // Make a worksheet with just headers
  const worksheetData = [headers];
  const worksheet = xlsx.utils.aoa_to_sheet(worksheetData);

  // Create workbook
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, worksheet, "SKU Mapping");

  // Write workbook to buffer
  const buffer = xlsx.write(workbook, { type: "buffer", bookType: "xlsx" });

  // Set headers for download
  res.setHeader("Content-Disposition", "attachment; filename=sku_mapping_template.xlsx");
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.send(buffer);
});

export default router;
