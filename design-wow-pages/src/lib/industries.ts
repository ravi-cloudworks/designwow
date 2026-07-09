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

// Expanded goal set (10 options, icon-tile style, matching Target Audience's
// count/grid so the two paired cards land at the same height) — kept
// industry-agnostic since one designer's library and one industry tag serve
// many verticals.
export const GOALS: { value: string; label: string }[] = [
  { value: 'increase_sales', label: 'Increase Sales' },
  { value: 'brand_awareness', label: 'Brand Awareness' },
  { value: 'promote_new_product', label: 'Promote New Product' },
  { value: 'drive_inquiries', label: 'Drive Inquiries' },
  { value: 'website_visits', label: 'Website Visits' },
  { value: 'more_followers', label: 'More Followers' },
  { value: 'announce_offer', label: 'Announce Offer' },
  { value: 'build_trust', label: 'Build Trust' },
  { value: 'increase_engagement', label: 'Increase Engagement' },
  { value: 'educate_customers', label: 'Educate Customers' },
];

// Buyer-persona categories — same structure as the reference layout, kept
// generic rather than seafood-specific since designers serve many industries.
export const TARGET_AUDIENCES: { value: string; label: string }[] = [
  { value: 'families', label: 'Families' },
  { value: 'personal_use', label: 'Home / Personal Use' },
  { value: 'quality_conscious', label: 'Quality-Conscious Buyers' },
  { value: 'health_conscious', label: 'Health Conscious' },
  { value: 'business_retail', label: 'Business & Retail Buyers' },
  { value: 'young_professionals', label: 'Young Professionals' },
  { value: 'luxury_buyers', label: 'Luxury Buyers' },
  { value: 'domestic_market', label: 'Domestic Market' },
  { value: 'export_buyers', label: 'Export / International Buyers' },
  { value: 'general_audience', label: 'General Audience' },
];

export const ASPECT_RATIOS: { value: string; label: string }[] = [
  { value: '9:16', label: '9:16 (Vertical)' },
  { value: '1:1', label: '1:1 (Square)' },
  { value: '4:5', label: '4:5 (Portrait)' },
  { value: '16:9', label: '16:9 (Horizontal)' },
];

export const LANGUAGES: { value: string; label: string }[] = [
  { value: 'english', label: 'English' },
  { value: 'hindi', label: 'Hindi' },
  { value: 'tamil', label: 'Tamil' },
  { value: 'telugu', label: 'Telugu' },
  { value: 'kannada', label: 'Kannada' },
  { value: 'malayalam', label: 'Malayalam' },
  { value: 'bengali', label: 'Bengali' },
  { value: 'other', label: 'Other' },
];

export const VOICE_TYPES: { value: string; label: string }[] = [
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
  { value: 'no_preference', label: 'No Preference' },
];

export const SUBTITLE_OPTIONS: { value: string; label: string }[] = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
];

// Static, informational-only — not tied to any enforcement in the app.
// Shown so the customer sees the standard delivery terms up front and
// confirms understanding before submitting.
export const APPROVAL_TERMS: string[] = [
  'Low-resolution preview delivered within your plan’s SLA window',
  '50% advance typically requested before final production begins',
  'The first round of feedback is treated as standard revision',
  'Larger changes after that may need extra time or cost — your designer will flag this before proceeding',
  'Final HD video delivered after you approve the revision',
  'Remaining balance is settled directly with your designer via UPI',
];
