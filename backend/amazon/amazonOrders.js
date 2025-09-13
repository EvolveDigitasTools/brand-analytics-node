import dotenv from "dotenv";
import SellingPartnerAPI from "amazon-sp-api";
import db from "../db.js";

dotenv.config();

// Fetch latest orders and store/update in DB
export async function fetchAndStoreAmazonOrders() {
  try {
    const sp = new SellingPartnerAPI({
      region: "fe",
      refresh_token: process.env.LWA_REFRESH_TOKEN,
      clientId: process.env.SELLING_PARTNER_APP_CLIENT_ID,
      clientSecret: process.env.SELLING_PARTNER_APP_CLIENT_SECRET,
    });

    console.log("SELLING_PARTNER_APP_CLIENT_ID:", process.env.SELLING_PARTNER_APP_CLIENT_ID ? "Loaded ✅" : "Missing ❌");
    console.log("MARKETPLACE_ID:", process.env.MARKETPLACE_ID);

    const createdAfter = new Date(Date.now() - 1 * 60 * 1000).toISOString();

    const res = await sp.callAPI({
      operation: "getOrders",
      endpoint: "orders",
      query: {
        MarketplaceIds: [process.env.MARKETPLACE_ID],
        CreatedAfter: createdAfter,
        orderStatuses: ["Unshipped", "Shipped", "Pending"],
      },
    });

    const orders = res.Orders || [];
    console.log(`Fetched ${orders.length} new orders`);

    for (const order of orders) {
      console.log("📦 Processing Order:", order.AmazonOrderId, order.OrderStatus);
      await upsertOrder(order);

      const itemsRes = await sp.callAPI({
        operation: "getOrderItems",
        endpoint: "orders",
        path: { orderId: order.AmazonOrderId },
      });

      const items = itemsRes.OrderItems || [];
      for (const item of items) {
        console.log("   ➕ Item:", item.SellerSKU, "Qty:", item.QuantityOrdered);
        await upsertOrderItem(order.AmazonOrderId, item);
      }
    }

    return { success: true, count: orders.length };
  } catch (error) {
    console.error("Error fetching Amazon orders:", error.message);
    return { success: false, error: error.message };
  }
}

// Insert or Update Order into DB
async function upsertOrder(order) {
  await db.query(
    `INSERT INTO amazon_orders 
      (amazon_order_id, buyer_name, order_status, purchase_date, city, state, country_code, order_total, currency_code, raw_payload) 
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
      buyer_name = VALUES(buyer_name),
      order_status = VALUES(order_status),
      city = VALUES(city),
      state = VALUES(state),
      country_code = VALUES(country_code),
      order_total = VALUES(order_total),
      currency_code = VALUES(currency_code),
      raw_payload = VALUES(raw_payload)`,
    [
      order.AmazonOrderId,
      order.BuyerInfo?.BuyerName || null,
      order.OrderStatus,
      order.PurchaseDate,
      order.ShippingAddress?.City || null,
      order.ShippingAddress?.StateOrRegion || null,
      order.ShippingAddress?.CountryCode || null,
      order.OrderTotal?.Amount || null,
      order.OrderTotal?.CurrencyCode || null,
      JSON.stringify(order),
    ]
  );
}

// Insert or Update Item into DB
async function upsertOrderItem(amazonOrderId, item) {
  await db.query(
    `INSERT INTO amazon_order_items 
      (amazon_order_id, asin, seller_sku, title, quantity_ordered, item_price, currency_code, raw_payload)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
      title = VALUES(title),
      quantity_ordered = VALUES(quantity_ordered),
      item_price = VALUES(item_price),
      currency_code = VALUES(currency_code),
      raw_payload = VALUES(raw_payload)`,
    [
      amazonOrderId,
      item.ASIN,
      item.SellerSKU,
      item.Title,
      item.QuantityOrdered,
      item.ItemPrice?.Amount || null,
      item.ItemPrice?.CurrencyCode || null,
      JSON.stringify(item),
    ]
  );
}