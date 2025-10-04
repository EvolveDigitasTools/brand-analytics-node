import express from "express";
import multer from "multer";
import xlsx from "xlsx";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import db from "./db.js";
import cron from "node-cron";
import comboSkuRutes from "./routes/comboSkuRoutes.js"; //Combo Routes
import { fetchAndStoreAmazonOrders } from "./amazon/amazonOrders.js";
import { v4 as uuidv4 } from 'uuid'; // Generate random orderId for orders table

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// ===== Combo SKU Mapping Route ======
app.use("/api/combo-sku", comboSkuRutes);

// Multer config
// const upload = multer({ dest: "uploads/" });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-excel', // .xls
      'text/csv', // .csv
      'application/csv', // sometimes CSV files
      'text/plain', // some CSV files can have this mime (depends on client)
      'application/vnd.oasis.opendocument.spreadsheet', // .ods (OpenDocument Spreadsheet)
    ];
    if (!allowedTypes.includes(file.mimetype)) {
      return cb(new Error('Only Excel, CSV, and ODS files are allowed'), false);
    }
    cb(null, true);
  },
});


//Running port
const PORT = process.env.PORT || 4000;

//Heath test
app.get("/", (req, res) => {
  res.send("✅ Backend is running!");
});

// ====================== MARKETPLACES INVENTORY UPDATE ======================
// Meesho Upload Route - Phase 6 - Working along normal and combo skus (Combo SKUs - Phase 3)
// app.post("/meesho-sse", upload.single("file"), async (req, res) => {
//   if (!req.file) {
//     res.status(400).json({ message: "No file uploaded" });
//     return;
//   }

//   res.setHeader("Content-Type", "text/event-stream");
//   res.setHeader("Cache-Control", "no-cache");
//   res.setHeader("Connection", "keep-alive");

//   const startTime = Date.now();
//   const allowedReasons = ["SHIPPED", "DELIVERED", "READY_TO_SHIP", "DOOR_STEP_EXCHANGED"];

//   const heartbeat = setInterval(() => {
//     res.write(":\n\n");
//   }, 15000);

//   try {
//     const workbook = xlsx.readFile(req.file.path);
//     const sheetName = workbook.SheetNames[0];
//     const sheet = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

//     if (!sheet[0] || !sheet[0]["SKU"] || !sheet[0]["Reason for Credit Entry"] || !sheet[0]["Quantity"]) {
//       res.write(`data: ${JSON.stringify({ error: "Invalid Excel file format" })}\n\n`);
//       clearInterval(heartbeat);
//       return res.end();
//     }

//     const allowedSheet = sheet.filter(row => {
//       const reason = String(row["Reason for Credit Entry"] || "")
//         .replace(/\s+/g, ' ')
//         .trim()
//         .toUpperCase();
//       const isAllowed = allowedReasons.includes(reason);
//       if (!isAllowed) {
//         console.log(`Skipping row with reason: ${reason}, SKU: ${row["SKU"]}`);
//       }
//       return isAllowed;
//     });

//     if (allowedSheet.length === 0) {
//       res.write(`data: ${JSON.stringify({ error: "No rows with allowed reasons found" })}\n\n`);
//       clearInterval(heartbeat);
//       return res.end();
//     }

//     console.log(`Processing ${allowedSheet.length} rows`);
//     const totalRows = allowedSheet.length;
//     const [allNormalSkus] = await db.query("SELECT id, skuCode FROM sku");
//     const normalSkuMap = {};
//     allNormalSkus.forEach(sku => {
//       normalSkuMap[sku.skuCode.trim().toLowerCase()] = sku;
//     });

//     const batchResults = [];
//     const flushBatch = (progressPercent) => {
//       if (batchResults.length > 0) {
//         console.log(`Flushing batch with ${batchResults.length} items at ${progressPercent}%`);
//         res.write(`data: ${JSON.stringify({ progressPercent, batch: batchResults })}\n\n`);
//         batchResults.length = 0;
//       }
//     };

//     // Track processed SKUs for logging duplicates (no deduplication in results)
//     const processedSkus = new Set();
//     for (let i = 0; i < allowedSheet.length; i++) {
//       const row = allowedSheet[i];
//       const originalSku = row["SKU"];
//       const reason = String(row["Reason for Credit Entry"] || "").replace(/\s+/g, ' ').trim().toUpperCase();
//       const qty = parseInt(row["Quantity"]);
//       let resultObj = null;

//       if (!originalSku || isNaN(qty) || qty <= 0) {
//         resultObj = { uploadedSku: originalSku, error: "Invalid SKU or quantity", reason };
//         batchResults.push(resultObj);
//         continue;
//       }

//       if (processedSkus.has(originalSku)) {
//         console.log(`Duplicate SKU detected: ${originalSku}`);
//       }
//       processedSkus.add(originalSku);

//       let skuCode = String(originalSku).trim();
//       let multiplier = 1;
//       const pkMatch = skuCode.match(/-PK(\d+)$/i);
//       if (pkMatch) {
//         multiplier = parseInt(pkMatch[1], 10);
//         skuCode = skuCode.replace(/-PK\d+$/i, "").trim();
//       }

//       const [comboRows] = await db.query(
//         `SELECT csi.sku_id, csi.quantity 
//          FROM combo_sku cs
//          JOIN combo_sku_items csi ON cs.id = csi.combo_sku_id
//          WHERE TRIM(LOWER(cs.combo_name)) = LOWER(?)`,
//         [originalSku.trim()]
//       );

//       if (comboRows.length > 0) {
//         for (const child of comboRows) {
//           const childSkuId = child.sku_id;
//           const deductQtyChild = qty * child.quantity;

//           let [invRows] = await db.query(
//             "SELECT id, quantity FROM inventory WHERE skuId = ? LIMIT 1",
//             [childSkuId]
//           );

//           if (invRows.length === 0) {
//             const [insertInv] = await db.query(
//               "INSERT INTO inventory (skuId, quantity, inventoryUpdatedAt) VALUES (?, 0, NOW())",
//               [childSkuId]
//             );
//             invRows = [{ id: insertInv.insertId, quantity: 0 }];
//           }

//           const inventory = invRows[0];
//           const newQty = Math.max(0, inventory.quantity - deductQtyChild);

//           await db.query(
//             "UPDATE inventory SET quantity = ?, inventoryUpdatedAt = NOW() WHERE id = ?",
//             [newQty, inventory.id]
//           );

//           resultObj = {
//             uploadedSku: originalSku,
//             comboSku: originalSku,
//             childSku: childSkuId,
//             oldQty: inventory.quantity,
//             deducted: deductQtyChild,
//             newQty,
//             reason,
//           };

//           batchResults.push(resultObj);
//         }
//       } else {
//         const normalSku = normalSkuMap[skuCode.toLowerCase()];
//         if (normalSku) {
//           const skuId = normalSku.id;
//           const deductQty = qty * multiplier;

//           let [invRows] = await db.query(
//             "SELECT id, quantity FROM inventory WHERE skuId = ? LIMIT 1",
//             [skuId]
//           );

//           if (invRows.length === 0) {
//             const [insertInv] = await db.query(
//               "INSERT INTO inventory (skuId, quantity, inventoryUpdatedAt) VALUES (?, 0, NOW())",
//               [skuId]
//             );
//             invRows = [{ id: insertInv.insertId, quantity: 0 }];
//           }

//           const inventory = invRows[0];
//           const newQty = Math.max(0, inventory.quantity - deductQty);

//           await db.query(
//             "UPDATE inventory SET quantity = ?, inventoryUpdatedAt = NOW() WHERE id = ?",
//             [newQty, inventory.id]
//           );

//           resultObj = {
//             uploadedSku: originalSku,
//             type: "normal",
//             skuCode: normalSku.skuCode,
//             oldQty: inventory.quantity,
//             deducted: deductQty,
//             newQty,
//             reason,
//           };

//           batchResults.push(resultObj);
//         } else {
//           resultObj = { uploadedSku: originalSku, error: "SKU not found (normal or combo)", reason };
//           batchResults.push(resultObj);
//         }
//       }

//       if (batchResults.length >= 50 || i === allowedSheet.length - 1) { // Increased to 50
//         const progressPercent = Math.round(((i + 1) / totalRows) * 100);
//         flushBatch(progressPercent);
//       }
//     }

//     fs.unlink(req.file.path, () => {});
//     clearInterval(heartbeat);
//     res.write(`data: ${JSON.stringify({ done: true, executionTime: Date.now() - startTime })}\n\n`);
//     res.end();

//   } catch (err) {
//     console.error("Error in /meesho-sse:", err);
//     clearInterval(heartbeat);
//     res.write(`data: ${JSON.stringify({ error: "Something went wrong" })}\n\n`);
//     res.end();
//   }
// });

// Meesho Upload Route - Phase 7 Working - With real time pregress bar
// app.post("/meesho-sse", upload.single("file"), async (req, res) => {
//   if (!req.file) return res.status(400).json({ message: "No file uploaded" });

//   // SSE headers
//   res.setHeader("Content-Type", "text/event-stream");
//   res.setHeader("Cache-Control", "no-cache");
//   res.setHeader("Connection", "keep-alive");

//   const startTime = Date.now();
//   const allowedReasons = ["SHIPPED", "DELIVERED", "READY_TO_SHIP", "DOOR_STEP_EXCHANGED"];

//   try {
//     const workbook = xlsx.readFile(req.file.path);
//     const sheetName = workbook.SheetNames[0];
//     const sheet = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

//     if (!sheet[0] || !sheet[0]["SKU"] || !sheet[0]["Reason for Credit Entry"] || !sheet[0]["Quantity"]) {
//       res.write(`data: ${JSON.stringify({ error: "Invalid Excel file format" })}\n\n`);
//       return res.end();
//     }

//     const totalRows = sheet.length;
//     const processedSKUs = {}; // To prevent duplicate rendering

//     for (let i = 0; i < sheet.length; i++) {
//       const row = sheet[i];
//       const originalSku = row["SKU"];
//       const reason = row["Reason for Credit Entry"];
//       const qty = parseInt(row["Quantity"]);
//       let resultObj = null;

//       try {
//         if (!originalSku || !reason || isNaN(qty) || qty <= 0) {
//           resultObj = { uploadedSku: originalSku, error: "Invalid SKU, reason, or quantity" };
//         } else if (!allowedReasons.includes(reason)) {
//           resultObj = { uploadedSku: originalSku, error: "Reason not allowed" };
//         } else {
//           let skuCode = String(originalSku).trim();
//           let multiplier = 1;
//           const pkMatch = skuCode.match(/-PK(\d+)$/i);
//           if (pkMatch) {
//             multiplier = parseInt(pkMatch[1], 10);
//             skuCode = skuCode.replace(/-PK\d+$/i, "").trim();
//           }

//           // Combo SKU
//           const [comboRows] = await db.query(
//             `SELECT csi.sku_id, csi.quantity 
//              FROM combo_sku cs
//              JOIN combo_sku_items csi ON cs.id = csi.combo_sku_id
//              WHERE TRIM(LOWER(cs.combo_name)) = LOWER(?)`,
//             [String(originalSku).trim()]
//           );

//           if (comboRows.length > 0) {
//             let totalOldQty = 0;
//             let totalDeducted = 0;
//             let totalNewQty = 0;

//             for (const child of comboRows) {
//               const childSkuId = child.sku_id;
//               const deductQtyChild = qty * child.quantity;

//               let [invRows] = await db.query(
//                 "SELECT id, quantity FROM inventory WHERE skuId = ? LIMIT 1",
//                 [childSkuId]
//               );

//               let inventoryId, currentQty;
//               if (invRows.length === 0) {
//                 const [insertInv] = await db.query(
//                   "INSERT INTO inventory (skuId, quantity, inventoryUpdatedAt) VALUES (?, 0, NOW())",
//                   [childSkuId]
//                 );
//                 inventoryId = insertInv.insertId;
//                 currentQty = 0;
//               } else {
//                 inventoryId = invRows[0].id;
//                 currentQty = invRows[0].quantity;
//               }

//               const newQty = Math.max(0, currentQty - deductQtyChild);
//               await db.query(
//                 "UPDATE inventory SET quantity = ?, inventoryUpdatedAt = NOW() WHERE id = ?",
//                 [newQty, inventoryId]
//               );

//               totalOldQty += currentQty;
//               totalDeducted += deductQtyChild;
//               totalNewQty += newQty;

//               // Prevent duplicate for same child SKU
//               const key = `combo-${childSkuId}`;
//               if (!processedSKUs[key]) {
//                 resultObj = {
//                   uploadedSku: originalSku,
//                   comboSku: originalSku,
//                   childSku: childSkuId,
//                   oldQty: currentQty,
//                   deducted: deductQtyChild,
//                   newQty,
//                   reason,
//                 };
//                 processedSKUs[key] = true;
//               }
//             }
//           } else {
//             // Normal SKU
//             const [skuRows] = await db.query(
//               "SELECT id, skuCode FROM sku WHERE TRIM(LOWER(skuCode)) = LOWER(?)",
//               [skuCode]
//             );

//             if (skuRows.length > 0) {
//               const skuId = skuRows[0].id;
//               const foundSkuCode = skuRows[0].skuCode;
//               const deductQty = qty * multiplier;

//               let [invRows] = await db.query(
//                 "SELECT id, quantity FROM inventory WHERE skuId = ? LIMIT 1",
//                 [skuId]
//               );

//               if (invRows.length === 0) {
//                 const [insertInv] = await db.query(
//                   "INSERT INTO inventory (skuId, quantity, inventoryUpdatedAt) VALUES (?, 0, NOW())",
//                   [skuId]
//                 );
//                 invRows = [{ id: insertInv.insertId, quantity: 0 }];
//               }

//               const inventory = invRows[0];
//               const newQty = Math.max(0, inventory.quantity - deductQty);

//               await db.query(
//                 "UPDATE inventory SET quantity = ?, inventoryUpdatedAt = NOW() WHERE id = ?",
//                 [newQty, inventory.id]
//               );

//               const key = `normal-${skuId}`;
//               if (!processedSKUs[key]) {
//                 resultObj = {
//                   uploadedSku: originalSku,
//                   type: "normal",
//                   skuCode: foundSkuCode,
//                   oldQty: inventory.quantity,
//                   deducted: deductQty,
//                   newQty,
//                   reason,
//                 };
//                 processedSKUs[key] = true;
//               }
//             } else {
//               resultObj = { uploadedSku: originalSku, error: "SKU not found (normal or combo)" };
//             }
//           }
//         }
//       } catch (err) {
//         resultObj = { uploadedSku: originalSku, error: err.message };
//       }

//       // Send progress via SSE
//       const progressPercent = Math.round(((i + 1) / totalRows) * 100);
//       res.write(`data: ${JSON.stringify({ progressPercent, latest: resultObj })}\n\n`);
//     }

//     fs.unlink(req.file.path, () => {});
//     res.write(`data: ${JSON.stringify({ done: true, executionTime: Date.now() - startTime })}\n\n`);
//     res.end();
//   } catch (err) {
//     console.error(err);
//     res.write(`data: ${JSON.stringify({ error: "Something went wrong" })}\n\n`);
//     res.end();
//   }
// });

// Meesho Upload Route - Phase 8 Working - Showing all SKUs result
// app.post("/meesho-sse", upload.single("file"), async (req, res) => {
//   const allowedReasons = ["SHIPPED", "DELIVERED", "READY_TO_SHIP", "DOOR_STEP_EXCHANGED"];
//   if (!req.file) {
//     res.status(400).json({ message: "No file uploaded" });
//     return;
//   }

//   res.setHeader("Content-Type", "text/event-stream");
//   res.setHeader("Cache-Control", "no-cache");
//   res.setHeader("Connection", "keep-alive");

//   const startTime = Date.now();

//   const log = (message) => {
//     const timestamp = new Date().toISOString();
//     console.log(`${timestamp} - ${message}`);
//   };

//   const heartbeat = setInterval(() => {
//     res.write(":\n\n");
//   }, 15000);

//   try {
//     log(`Starting processing for file: ${req.file.path}`);
//     const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
//     const sheetName = workbook.SheetNames[0];
//     const sheet = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

//     if (!sheet[0] || !sheet[0]["SKU"] || !sheet[0]["Reason for Credit Entry"] || !sheet[0]["Quantity"]) {
//       log(`Error: Invalid Excel file format`);
//       res.write(`data: ${JSON.stringify({ error: "Invalid Excel file format" })}\n\n`);
//       clearInterval(heartbeat);
//       return res.end();
//     }

//     const allowedSheet = sheet.filter(row => {
//       const reason = String(row["Reason for Credit Entry"] || "")
//         .replace(/\s+/g, ' ')
//         .trim()
//         .toUpperCase();
//       const isAllowed = allowedReasons.includes(reason);
//       if (!isAllowed) {
//         log(`Skipping row with reason: ${reason}, SKU: ${row["SKU"]}`);
//       }
//       return isAllowed;
//     });

//     const totalRows = allowedSheet.length;
//     log(`Processing ${totalRows} rows (all READY_TO_SHIP)`);
//     if (totalRows === 0) {
//       log(`Error: No rows with allowed reasons found`);
//       res.write(`data: ${JSON.stringify({ error: "No rows with allowed reasons found" })}\n\n`);
//       clearInterval(heartbeat);
//       return res.end();
//     }

//     const [allNormalSkus] = await db.query("SELECT id, skuCode FROM sku");
//     const normalSkuMap = {};
//     allNormalSkus.forEach(sku => {
//       normalSkuMap[sku.skuCode.trim().toLowerCase()] = sku;
//     });

//     let successfulUpdates = 0;
//     for (let i = 0; i < allowedSheet.length; i++) {
//       try {
//         const row = allowedSheet[i];
//         const originalSku = row["SKU"];
//         const reason = String(row["Reason for Credit Entry"] || "").replace(/\s+/g, ' ').trim().toUpperCase();
//         const qty = parseInt(row["Quantity"]);
//         let resultObj = null;

//         if (!originalSku || isNaN(qty) || qty <= 0) {
//           resultObj = { uploadedSku: originalSku, error: "Invalid SKU or quantity", reason };
//           res.write(`data: ${JSON.stringify(resultObj)}\n\n`);
//           log(`Row ${i + 1}: Invalid SKU or quantity for ${originalSku || 'undefined'}`);
//           continue;
//         }

//         // Log if this SKU appears multiple times (no skipping)
//         if (i > 0 && allowedSheet.slice(0, i).some(r => r["SKU"] === originalSku)) {
//           log(`Duplicate SKU detected: ${originalSku} at row ${i + 1}`);
//         }

//         let skuCode = typeof originalSku === 'string' ? originalSku.trim() : String(originalSku);
//         let multiplier = 1;
//         const pkMatch = skuCode.match(/-PK(\d+)$/i);
//         if (pkMatch) {
//           multiplier = parseInt(pkMatch[1], 10);
//           skuCode = skuCode.replace(/-PK\d+$/i, "").trim();
//         }

//         const [comboRows] = await db.query(
//           `SELECT csi.sku_id, csi.quantity 
//            FROM combo_sku cs
//            JOIN combo_sku_items csi ON cs.id = csi.combo_sku_id
//            WHERE TRIM(LOWER(cs.combo_name)) = LOWER(?)`,
//           [skuCode]
//         );

//         let updatePerformed = false;
//         if (comboRows.length > 0) {
//           for (const child of comboRows) {
//             const childSkuId = child.sku_id;
//             const deductQtyChild = qty * child.quantity;

//             let [invRows] = await db.query(
//               "SELECT id, quantity FROM inventory WHERE skuId = ? LIMIT 1",
//               [childSkuId]
//             );

//             if (invRows.length === 0) {
//               const [insertInv] = await db.query(
//                 "INSERT INTO inventory (skuId, quantity, inventoryUpdatedAt) VALUES (?, 0, NOW())",
//                 [childSkuId]
//               );
//               invRows = [{ id: insertInv.insertId, quantity: 0 }];
//             }

//             const inventory = invRows[0];
//             const newQty = Math.max(0, inventory.quantity - deductQtyChild);

//             await db.query(
//               "UPDATE inventory SET quantity = ?, inventoryUpdatedAt = NOW() WHERE id = ?",
//               [newQty, inventory.id]
//             );

//             resultObj = {
//               uploadedSku: originalSku,
//               comboSku: originalSku,
//               childSku: childSkuId,
//               oldQty: inventory.quantity,
//               deducted: deductQtyChild,
//               newQty,
//               reason,
//             };

//             res.write(`data: ${JSON.stringify(resultObj)}\n\n`); // Send each update individually
//             updatePerformed = true;
//           }
//         } else {
//           const normalSku = normalSkuMap[skuCode.toLowerCase()];
//           if (normalSku) {
//             const skuId = normalSku.id;
//             const deductQty = qty * multiplier;

//             let [invRows] = await db.query(
//               "SELECT id, quantity FROM inventory WHERE skuId = ? LIMIT 1",
//               [skuId]
//             );

//             if (invRows.length === 0) {
//               const [insertInv] = await db.query(
//                 "INSERT INTO inventory (skuId, quantity, inventoryUpdatedAt) VALUES (?, 0, NOW())",
//                 [skuId]
//               );
//               invRows = [{ id: insertInv.insertId, quantity: 0 }];
//             }

//             const inventory = invRows[0];
//             const newQty = Math.max(0, inventory.quantity - deductQty);

//             await db.query(
//               "UPDATE inventory SET quantity = ?, inventoryUpdatedAt = NOW() WHERE id = ?",
//               [newQty, inventory.id]
//             );

//             resultObj = {
//               uploadedSku: originalSku,
//               type: "normal",
//               skuCode: normalSku.skuCode,
//               oldQty: inventory.quantity,
//               deducted: deductQty,
//               newQty,
//               reason,
//             };

//             res.write(`data: ${JSON.stringify(resultObj)}\n\n`); // Send each update individually
//             updatePerformed = true;
//           } else {
//             resultObj = { uploadedSku: originalSku, error: "SKU not found (normal or combo)", reason };
//             res.write(`data: ${JSON.stringify(resultObj)}\n\n`); // Send error individually
//             log(`Row ${i + 1}: Failed to process SKU ${originalSku}`);
//           }
//         }

//         if (updatePerformed) {
//           successfulUpdates++;
//           log(`Row ${i + 1}: Successfully updated ${originalSku}`);
//         }

//         const progressPercent = Math.round(((i + 1) / totalRows) * 100);
//         res.write(`data: ${JSON.stringify({ progressPercent })}\n\n`); // Send progress per row
//       } catch (error) {
//         const row = allowedSheet[i] || {};
//         const originalSku = row["SKU"];
//         const reason = String(row["Reason for Credit Entry"] || "").replace(/\s+/g, ' ').trim().toUpperCase();
//         log(`Error processing row ${i + 1}: ${error.message}, SKU: ${originalSku}, Reason: ${reason}`);
//         const resultObj = { uploadedSku: originalSku, error: `Processing error: ${error.message}`, reason };
//         res.write(`data: ${JSON.stringify(resultObj)}\n\n`); // Send error individually
//         const progressPercent = Math.round(((i + 1) / totalRows) * 100);
//         res.write(`data: ${JSON.stringify({ progressPercent })}\n\n`);
//       }
//     }

//     log(`Total successful updates: ${successfulUpdates}, Total rows processed: ${allowedSheet.length}`);
//     // fs.unlink(req.file.path, () => {});
//     clearInterval(heartbeat);
//     res.write(`data: ${JSON.stringify({ done: true, executionTime: Date.now() - startTime })}\n\n`);
//     res.end();

//   } catch (err) {
//     log(`Critical error in /meesho-sse: ${err.message}`);
//     clearInterval(heartbeat);
//     res.write(`data: ${JSON.stringify({ error: "Something went wrong" })}\n\n`);
//     res.end();
//   }
// });

// Meesho Upload Route - Phase 9 Working - Save upload result in DB for Sale Last 15 Days
app.post("/meesho-sse", upload.single("file"), async (req, res) => {
  const allowedReasons = ["SHIPPED", "DELIVERED", "READY_TO_SHIP", "DOOR_STEP_EXCHANGED"];
  if (!req.file) {
    res.status(400).json({ message: "No file uploaded" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const startTime = Date.now();

  const log = (message) => {
    const timestamp = new Date().toISOString();
    console.log(`${timestamp} - ${message}`);
  };

  const heartbeat = setInterval(() => {
    res.write(":\n\n");
  }, 15000);

  try {
    log(`Starting processing for file: ${req.file.path}`);
    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

    if (!sheet[0] || !sheet[0]["SKU"] || !sheet[0]["Reason for Credit Entry"] || !sheet[0]["Quantity"]) {
      log(`Error: Invalid Excel file format`);
      res.write(`data: ${JSON.stringify({ error: "Invalid Excel file format" })}\n\n`);
      clearInterval(heartbeat);
      return res.end();
    }

    const allowedSheet = sheet.filter(row => {
      const reason = String(row["Reason for Credit Entry"] || "")
        .replace(/\s+/g, ' ')
        .trim()
        .toUpperCase();
      const isAllowed = allowedReasons.includes(reason);
      if (!isAllowed) {
        log(`Skipping row with reason: ${reason}, SKU: ${row["SKU"]}`);
      }
      return isAllowed;
    });

    const totalRows = allowedSheet.length;
    log(`Processing ${totalRows} rows (all READY_TO_SHIP)`);
    if (totalRows === 0) {
      log(`Error: No rows with allowed reasons found`);
      res.write(`data: ${JSON.stringify({ error: "No rows with allowed reasons found" })}\n\n`);
      clearInterval(heartbeat);
      return res.end();
    }

    const [allNormalSkus] = await db.query("SELECT id, skuCode FROM sku");
    const normalSkuMap = {};
    allNormalSkus.forEach(sku => {
      normalSkuMap[sku.skuCode.trim().toLowerCase()] = sku;
    });

    let successfulUpdates = 0;
    for (let i = 0; i < allowedSheet.length; i++) {
      try {
        const row = allowedSheet[i];
        const originalSku = row["SKU"];
        const reason = String(row["Reason for Credit Entry"] || "").replace(/\s+/g, ' ').trim().toUpperCase();
        const qty = parseInt(row["Quantity"]);
        let resultObj = null;

        if (!originalSku || isNaN(qty) || qty <= 0) {
          resultObj = { uploadedSku: originalSku, error: "Invalid SKU or quantity", reason };
          res.write(`data: ${JSON.stringify(resultObj)}\n\n`);
          log(`Row ${i + 1}: Invalid SKU or quantity for ${originalSku || 'undefined'}`);
          continue;
        }

        // Log if this SKU appears multiple times (no skipping)
        if (i > 0 && allowedSheet.slice(0, i).some(r => r["SKU"] === originalSku)) {
          log(`Duplicate SKU detected: ${originalSku} at row ${i + 1}`);
        }

        let skuCode = typeof originalSku === 'string' ? originalSku.trim() : String(originalSku);
        let multiplier = 1;
        const pkMatch = skuCode.match(/-PK(\d+)$/i);
        if (pkMatch) {
          multiplier = parseInt(pkMatch[1], 10);
          skuCode = skuCode.replace(/-PK\d+$/i, "").trim();
        }

        const [comboRows] = await db.query(
          `SELECT csi.sku_id, csi.quantity 
           FROM combo_sku cs
           JOIN combo_sku_items csi ON cs.id = csi.combo_sku_id
           WHERE TRIM(LOWER(cs.combo_name)) = LOWER(?)`,
          [skuCode]
        );

        let updatePerformed = false;
        if (comboRows.length > 0) {
          for (const child of comboRows) {
            const childSkuId = child.sku_id;
            const deductQtyChild = qty * child.quantity;

            let [invRows] = await db.query(
              "SELECT id, quantity FROM inventory WHERE skuId = ? LIMIT 1",
              [childSkuId]
            );

            if (invRows.length === 0) {
              const [insertInv] = await db.query(
                "INSERT INTO inventory (skuId, quantity, inventoryUpdatedAt) VALUES (?, 0, NOW())",
                [childSkuId]
              );
              invRows = [{ id: insertInv.insertId, quantity: 0 }];
            }

            const inventory = invRows[0];
            const newQty = Math.max(0, inventory.quantity - deductQtyChild);

            await db.query(
              "UPDATE inventory SET quantity = ?, inventoryUpdatedAt = NOW() WHERE id = ?",
              [newQty, inventory.id]
            );

            // Insert order with generated orderId
            const orderDate = new Date();
            const generatedOrderId = uuidv4(); // Generate a unique orderId
            const [orderResult] = await db.query(
              "INSERT INTO orders (orderDateTime, orderStatus, marketplace, orderId) VALUES (?, ?, ?, ?)",
              [orderDate, reason, "MEESHO", generatedOrderId]
            );
            const orderId = orderResult.insertId;
            await db.query(
              "INSERT INTO order_items (order_id, sku_id, quantity) VALUES (?, ?, ?)",
              [orderId, childSkuId, deductQtyChild]
            );

            resultObj = {
              uploadedSku: originalSku,
              comboSku: originalSku,
              childSku: childSkuId,
              oldQty: inventory.quantity,
              deducted: deductQtyChild,
              newQty,
              reason,
            };

            res.write(`data: ${JSON.stringify(resultObj)}\n\n`); // Send each update individually
            updatePerformed = true;
          }
        } else {
          const normalSku = normalSkuMap[skuCode.toLowerCase()];
          if (normalSku) {
            const skuId = normalSku.id;
            const deductQty = qty * multiplier;

            let [invRows] = await db.query(
              "SELECT id, quantity FROM inventory WHERE skuId = ? LIMIT 1",
              [skuId]
            );

            if (invRows.length === 0) {
              const [insertInv] = await db.query(
                "INSERT INTO inventory (skuId, quantity, inventoryUpdatedAt) VALUES (?, 0, NOW())",
                [skuId]
              );
              invRows = [{ id: insertInv.insertId, quantity: 0 }];
            }

            const inventory = invRows[0];
            const newQty = Math.max(0, inventory.quantity - deductQty);

            await db.query(
              "UPDATE inventory SET quantity = ?, inventoryUpdatedAt = NOW() WHERE id = ?",
              [newQty, inventory.id]
            );

            // Insert order with generated orderId
            const orderDate = new Date();
            const generatedOrderId = uuidv4(); // Generate a unique orderId
            const [orderResult] = await db.query(
              "INSERT INTO orders (orderDateTime, orderStatus, marketplace, orderId) VALUES (?, ?, ?, ?)",
              [orderDate, reason, "MEESHO", generatedOrderId]
            );
            const orderId = orderResult.insertId;
            await db.query(
              "INSERT INTO order_items (order_id, sku_id, quantity) VALUES (?, ?, ?)",
              [orderId, skuId, deductQty]
            );

            resultObj = {
              uploadedSku: originalSku,
              type: "normal",
              skuCode: normalSku.skuCode,
              oldQty: inventory.quantity,
              deducted: deductQty,
              newQty,
              reason,
            };

            res.write(`data: ${JSON.stringify(resultObj)}\n\n`); // Send each update individually
            updatePerformed = true;
          } else {
            resultObj = { uploadedSku: originalSku, error: "SKU not found (normal or combo)", reason };
            res.write(`data: ${JSON.stringify(resultObj)}\n\n`); // Send error individually
            log(`Row ${i + 1}: Failed to process SKU ${originalSku}`);
          }
        }

        if (updatePerformed) {
          successfulUpdates++;
          log(`Row ${i + 1}: Successfully updated ${originalSku}`);
        }

        const progressPercent = Math.round(((i + 1) / totalRows) * 100);
        res.write(`data: ${JSON.stringify({ progressPercent })}\n\n`); // Send progress per row
      } catch (error) {
        const row = allowedSheet[i] || {};
        const originalSku = row["SKU"];
        const reason = String(row["Reason for Credit Entry"] || "").replace(/\s+/g, ' ').trim().toUpperCase();
        log(`Error processing row ${i + 1}: ${error.message}, SKU: ${originalSku}, Reason: ${reason}`);
        const resultObj = { uploadedSku: originalSku, error: `Processing error: ${error.message}`, reason };
        res.write(`data: ${JSON.stringify(resultObj)}\n\n`); // Send error individually
        const progressPercent = Math.round(((i + 1) / totalRows) * 100);
        res.write(`data: ${JSON.stringify({ progressPercent })}\n\n`);
      }
    }

    log(`Total successful updates: ${successfulUpdates}, Total rows processed: ${allowedSheet.length}`);
    // fs.unlink(req.file.path, () => {});
    clearInterval(heartbeat);
    res.write(`data: ${JSON.stringify({ done: true, executionTime: Date.now() - startTime })}\n\n`);
    res.end();

  } catch (err) {
    log(`Critical error in /meesho-sse: ${err.message}`);
    clearInterval(heartbeat);
    res.write(`data: ${JSON.stringify({ error: "Something went wrong" })}\n\n`);
    res.end();
  }
});


// New endpoint to fetch sales for the last 15 days
app.get('/sales-last-15-days', async (req, res) => {
  const { vendorCode } = req.query; // Get vendorCode from query params

  try {
    let query = `
      SELECT s.skuCode, COALESCE(SUM(oi.quantity), 0) AS salesLast15Days
      FROM orders o
      LEFT JOIN order_items oi ON o.id = oi.order_id
      LEFT JOIN sku s ON oi.sku_id = s.id
      WHERE o.orderDateTime >= DATE_SUB(NOW(), INTERVAL 15 DAY)
      AND o.orderStatus IN ('SHIPPED', 'DELIVERED', 'READY_TO_SHIP', 'DOOR_STEP_EXCHANGED')
    `;

    const params = [];
    if (vendorCode) {
      query += ' AND s.vendorId = ?'; // Filter by vendorId from sku table
      params.push(vendorCode);
    }

    query += ' GROUP BY s.skuCode';

    const [rows] = await db.query(query, params);

    res.json({
      success: true,
      data: rows.map(row => ({
        skuCode: row.skuCode,
        salesLast15Days: row.salesLast15Days
      }))
    });
  } catch (error) {
    console.error('Error fetching sales last 15 days:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch sales data'
    });
  }
});


// Amazon Sheet Upload
app.post("/upload-amazon", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: "No file uploaded" });

  const startTime = Date.now();
  let results = [];

  // Allowed Amazon order statuses
  const allowedReasons = [
    "Pending",
    "Shipped",
    "Shipped - Delivered to Buyer",
    "Shipped - Out for Delivery",
    "Shipped - Picked Up",
    "Shipped - Returning to Seller",
    "Shipping",
  ];

  try {
    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

    for (const row of sheet) {
      const originalSku = row["sku"]; // Amazon sheet column
      let skuCode = String(originalSku || "").trim();
      const qty = parseInt(row["quantity"]);
      const reason = row["order-status"];

      if (!skuCode || isNaN(qty)) {
        results.push({ skuCode: originalSku, error: "Invalid SKU/Quantity" });
        continue;
      }

      if (!allowedReasons.includes(reason)) continue; // skip unwanted rows

      // Handle PK multiplier
      let multiplier = 1;
      const pkMatch = skuCode.match(/-PK(\d+)$/i);
      if (pkMatch) {
        multiplier = parseInt(pkMatch[1]);
        skuCode = skuCode.replace(/-PK\d+$/i, "");
      }

      try {
        // 1 Normal SKU (match Amazon column name style)
        const [skuRows] = await db.query(
          "SELECT id FROM sku WHERE skuCode = ?",
          [skuCode]
        );

        if (skuRows.length > 0) {
          const skuID = skuRows[0].id;
          const [invRows] = await db.query(
            "SELECT id, quantity FROM inventory WHERE skuID = ? LIMIT 1",
            [skuID]
          );

          if (invRows.length === 0) {
            results.push({ skuCode: originalSku, error: "No inventory record found" });
            continue;
          }

          const inventory = invRows[0];
          let newQty = Math.max(0, inventory.quantity - qty * multiplier);

          await db.query(
            "UPDATE inventory SET quantity = ?, inventoryUpdatedAt = NOW() WHERE id = ?",
            [newQty, inventory.id]
          );

          results.push({
            originalSku: String(originalSku),
            baseSku: skuCode,
            oldQty: inventory.quantity,
            deducted: qty * multiplier,
            newQty,
            reason,
          });
          continue;
        }

        // 2 Combo SKU
        const [comboRows] = await db.query(
          `SELECT csi.sku_id, csi.quantity
           FROM combo_sku cs
           JOIN combo_sku_items csi ON cs.id = csi.combo_sku_id
           WHERE cs.combo_name = ?`,
          [skuCode]
        );

        if (comboRows.length === 0) {
          results.push({ skuCode: originalSku, error: "SKU not found (normal or combo)" });
          continue;
        }

        for (const child of comboRows) {
          const [invRows] = await db.query(
            "SELECT id, quantity FROM inventory WHERE skuID = ? LIMIT 1",
            [child.sku_id]
          );

          if (invRows.length === 0) {
            results.push({ skuCode: child.sku_id, error: "No inventory record found" });
            continue;
          }

          const inventory = invRows[0];
          const deductQty = qty * multiplier * child.quantity;
          let newQty = Math.max(0, inventory.quantity - deductQty);

          await db.query(
            "UPDATE inventory SET quantity = ?, inventoryUpdatedAt = NOW() WHERE id = ?",
            [newQty, inventory.id]
          );

          results.push({
            comboSku: skuCode,
            childSku: child.sku_id,
            oldQty: inventory.quantity,
            deducted: deductQty,
            newQty,
            reason,
          });
        }

      } catch (err) {
        console.error("Error processing SKU:", skuCode, err);
        results.push({ skuCode: originalSku, error: err.message });
      }
    }

    // cleanup
    // fs.unlink(req.file.path, (err) => {
    //   if (err) console.error("File cleanup failed:", err);
    // });

    res.json({
      message: "Amazon Inventory updated",
      totalProcessed: results.length,
      totalErrors: results.filter(r => r.error).length,
      executionTime: (Date.now() - startTime) + "ms",
      results,
    });

  } catch (err) {
    console.error("Error processing Amazon file:", err);
    res.status(500).json({ error: "Failed to process Amazon file" });
  }
});

// Flipkart Sheet Upload
// Clean Flipkart SKU (remove extra quotes and SKU: prefix)
function cleanFlipkartSku(rawSku) {
  if (!rawSku) return null;
  return String(rawSku)
    .replace(/^"+|"+$/g, "")   // remove extra quotes
    .replace(/^SKU:/i, "")     // remove SKU: prefix
    .trim();
}
app.post("/upload-flipkart", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: "No file uploaded" });

  const startTime = Date.now();
  let results = [];

  // Allowed Flipkart event types
  const allowedReasons = ["Sale"];

  try {
    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

    for (const row of sheet) {
      const originalSku = cleanFlipkartSku(row["SKU"]);
      let skuCode = cleanFlipkartSku(row["SKU"]);

      const qty = parseInt(row["Item Quantity"]);
      const reason = row["Event Type"];

      if (!skuCode || isNaN(qty)) {
        results.push({ skuCode: originalSku, error: "Invalid SKU/Quantity" });
        continue;
      }

      if (!allowedReasons.includes(reason)) continue; // skip unwanted rows

      // Handle PK multiplier
      let multiplier = 1;
      const pkMatch = skuCode.match(/-PK(\d+)$/i);
      if (pkMatch) {
        multiplier = parseInt(pkMatch[1]);
        skuCode = skuCode.replace(/-PK\d+$/i, "");
      }

      try {
        // 🔹 1) Normal SKU
        const [skuRows] = await db.query(
          "SELECT id FROM sku WHERE skuCode = ?",
          [skuCode]
        );

        if (skuRows.length > 0) {
          const skuID = skuRows[0].id;
          const [invRows] = await db.query(
            "SELECT id, quantity FROM inventory WHERE skuID = ? LIMIT 1",
            [skuID]
          );

          if (invRows.length === 0) {
            results.push({ skuCode: originalSku, error: "No inventory record found" });
            continue;
          }

          const inventory = invRows[0];
          let newQty = Math.max(0, inventory.quantity - qty * multiplier);

          await db.query(
            "UPDATE inventory SET quantity = ?, inventoryUpdatedAt = NOW() WHERE id = ?",
            [newQty, inventory.id]
          );

          results.push({
            originalSku: String(originalSku),
            baseSku: skuCode,
            oldQty: inventory.quantity,
            deducted: qty * multiplier,
            newQty,
            reason,
          });
          continue;
        }

        // 🔹 2) Combo SKU
        const [comboRows] = await db.query(
          `SELECT csi.sku_id, csi.quantity
           FROM combo_sku cs
           JOIN combo_sku_items csi ON cs.id = csi.combo_sku_id
           WHERE cs.combo_name = ?`,
          [skuCode]
        );

        if (comboRows.length === 0) {
          results.push({ skuCode: originalSku, error: "SKU not found (normal or combo)" });
          continue;
        }

        for (const child of comboRows) {
          const [invRows] = await db.query(
            "SELECT id, quantity FROM inventory WHERE skuID = ? LIMIT 1",
            [child.sku_id]
          );

          if (invRows.length === 0) {
            results.push({ skuCode: child.sku_id, error: "No inventory record found" });
            continue;
          }

          const inventory = invRows[0];
          const deductQty = qty * multiplier * child.quantity;
          let newQty = Math.max(0, inventory.quantity - deductQty);

          await db.query(
            "UPDATE inventory SET quantity = ?, inventoryUpdatedAt = NOW() WHERE id = ?",
            [newQty, inventory.id]
          );

          results.push({
            comboSku: skuCode,
            childSku: child.sku_id,
            oldQty: inventory.quantity,
            deducted: deductQty,
            newQty,
            reason,
          });
        }

      } catch (err) {
        console.error("Error processing SKU:", skuCode, err);
        results.push({ skuCode: originalSku, error: err.message });
      }
    }

    // cleanup
    // fs.unlink(req.file.path, (err) => {
    //   if (err) console.error("File cleanup failed:", err);
    // });

    res.json({
      message: "Flipkart Inventory updated",
      totalProcessed: results.length,
      totalErrors: results.filter(r => r.error).length,
      executionTime: (Date.now() - startTime) + "ms",
      results,
    });

  } catch (err) {
    console.error("Error processing Flipkart file:", err);
    res.status(500).json({ error: "Failed to process Flipkart file" });
  }
});

// ====================== AMAZON REAL TIME ORDER STATUS ======================
// Test route to trigger manual sync
app.get("/api/fetch-amazon-orders", async (req, res) => {
  try {
    const result = await fetchAndStoreAmazonOrders();
    res.status(200).json({
      message: "Amazon orders fetched & stored successfully",
      result,
    });
  } catch (error) {
    res.status(500).json({ message: "Error fetching orders", error: error.message });
  }
});

app.get("/fetch-orders", async (req, res) => {
  const result = await fetchAndStoreAmazonOrders();
  res.json(result);
});

// Run every 1 minute
// cron.schedule("*/1 * * * *", async () => {
//   console.log("⏳ Fetching Amazon Orders...");
//   const result = await fetchAndStoreAmazonOrders();
//   console.log("✅ Orders Sync Result:", result);
// });

app.listen(PORT, () => {
  console.log(`Node backend running on port ${PORT}`);
});
