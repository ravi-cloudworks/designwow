// Shared taxonomy — the same tags power two filters: which designers get
// recommended first (specialty match), and which of a chosen designer's
// asset-library items show (industry match). Keeping one vocabulary
// instead of two avoids drift between them.
export const INDUSTRIES: { value: string; label: string }[] = [
  { value: 'seafood', label: 'Seafood' },
  { value: 'spices', label: 'Spices' },
  { value: 'rice', label: 'Rice / Basmati' },
  { value: 'pharmaceuticals', label: 'Pharmaceuticals' },
  { value: 'engineering', label: 'Engineering Goods' },
  { value: 'electrical', label: 'Electrical Equipment' },
  { value: 'jewelry', label: 'Jewelry' },
  { value: 'textiles', label: 'Textiles & Garments' },
  { value: 'chemicals', label: 'Organic Chemicals' },
  { value: 'building_materials', label: 'Ceramic Tiles / Building Materials' },
  { value: 'other', label: 'Other' },
];

export const SCRIPT_STYLES: { value: string; label: string }[] = [
  { value: 'founder_story', label: 'Founder Story' },
  { value: 'customer_testimonial', label: 'Customer Testimonial' },
  { value: 'product_benefits', label: 'Product Benefits' },
  { value: 'demo_walkthrough', label: 'Demo / Walkthrough' },
  { value: 'quality_guarantee', label: 'Quality Guarantee' },
  { value: 'offer_promo', label: 'Offer / Discount Promo' },
];

export const CTA_STYLES: { value: string; label: string }[] = [
  { value: 'order_now', label: 'Order Now' },
  { value: 'whatsapp_us', label: 'WhatsApp Us' },
  { value: 'visit_website', label: 'Visit Website' },
  { value: 'call_today', label: 'Call Today' },
  { value: 'dm_to_order', label: 'DM to Order' },
  { value: 'limited_time_offer', label: 'Limited Time Offer' },
];
