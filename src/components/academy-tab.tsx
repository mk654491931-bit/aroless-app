import { useEffect, useMemo, useState } from "react";
import {
  GraduationCap, ChevronDown, Check, CircleDashed, Trophy, Lightbulb,
  RotateCcw, PlayCircle, ExternalLink, ListChecks, BookOpen, AlertTriangle, MessageSquare,
} from "lucide-react";

type Quiz = { q: string; options: string[]; answer: number; why: string };

type Day = {
  day: number;
  week: 1 | 2 | 3;
  title: string;
  goal: string;
  minutes: number;
  /** Teaching content — written for someone who has never sold anything online. */
  sections: { heading: string; body: string }[];
  terms: { term: string; meaning: string }[];
  tasks: string[];
  mistake: string;
  video: { title: string; query: string };
  quiz: Quiz;
};

const DAYS: Day[] = [
  {
    day: 1,
    week: 1,
    title: "What e-commerce actually is",
    goal: "Understand how an online store makes money before you spend a single dollar.",
    minutes: 40,
    sections: [
      {
        heading: "The whole business in one sentence",
        body: "E-commerce is buying (or making) a product for one price, showing it to the right person on the internet, and selling it for a higher price. Everything else — the website, the ads, the packaging, the emails — exists only to make that one sentence happen more often and more cheaply.",
      },
      {
        heading: "The four business models",
        body: "1) Dropshipping: a supplier ships to your customer, you never hold stock. Lowest risk, lowest margin, slowest delivery. 2) Stocked reselling: you buy inventory up front and ship it yourself. Better margin and speed, needs capital. 3) Private label: the same factory product with your brand on it. Highest margin, needs 3-6 months. 4) Handmade / print-on-demand: you create the product. Slow to scale, but defensible. Beginners should start with dropshipping or stocked reselling to learn the mechanics, then move to private label once a product proves itself.",
      },
      {
        heading: "Where beginners lose money",
        body: "Almost nobody fails because their website was ugly. They fail because they picked a product nobody wanted, priced it too low to afford advertising, or quit after three days of testing. Your first 90 days are not about profit — they are about building a repeatable process: find product → test demand → build offer → drive traffic → read the numbers.",
      },
    ],
    terms: [
      { term: "SKU", meaning: "Stock Keeping Unit — one specific product variant (e.g. blue, size M)." },
      { term: "Margin", meaning: "What is left of the sale price after product, shipping and fees." },
      { term: "Fulfilment", meaning: "The process of getting the product from warehouse to customer." },
    ],
    tasks: [
      "Write one sentence: “I will sell ___ to ___ using the ___ model.”",
      "Decide your starting budget and write it down (a realistic first test is $300-600).",
      "Pick one model for the next 90 days and commit — no switching mid-way.",
    ],
    mistake: "Trying dropshipping, print-on-demand and Amazon FBA at the same time. Three half-built businesses beat by one finished one.",
    video: { title: "E-commerce business models explained for beginners", query: "ecommerce business models explained beginners dropshipping private label" },
    quiz: {
      q: "Which model lets you start without buying inventory up front?",
      options: ["Private label", "Dropshipping", "Stocked reselling", "Wholesale"],
      answer: 1,
      why: "In dropshipping the supplier ships directly to your customer, so you only pay for a product after it is sold.",
    },
  },
  {
    day: 2,
    week: 1,
    title: "Unit economics — the maths that decides everything",
    goal: "Be able to calculate whether a product can survive paid advertising.",
    minutes: 45,
    sections: [
      {
        heading: "The formula you will use every day",
        body: "Profit per order = Selling price − Product cost − Shipping − Payment/platform fees − Advertising cost per order − Refund allowance. If that number is negative, no amount of traffic saves you. Run this calculation BEFORE you build a store, not after.",
      },
      {
        heading: "A worked example",
        body: "Sell price $49.90. Product $12. Shipping $5. Payment fees ~3% = $1.50. Refunds/damages allowance 5% = $2.50. That leaves $28.90 of gross profit per order. If your ads cost $20 to produce one sale (that is a 2.5x ROAS), you keep $8.90 — thin but workable. If ads cost $30, you lose money on every sale even though revenue looks great.",
      },
      {
        heading: "Rules of thumb",
        body: "Aim for a 3x markup (sell at ~3× product cost) and at least 60% gross margin if you plan to advertise. Break-even ROAS = 1 ÷ gross margin %. At 60% margin your break-even ROAS is about 1.67, so anything above ~2.0 is profitable. Know that number by heart for your product.",
      },
    ],
    terms: [
      { term: "ROAS", meaning: "Return On Ad Spend — revenue ÷ ad spend. 3.0 means $3 back per $1 spent." },
      { term: "CPA / CAC", meaning: "Cost to acquire one paying customer." },
      { term: "AOV", meaning: "Average Order Value — average money per checkout." },
      { term: "Break-even ROAS", meaning: "The ROAS at which you make exactly zero profit." },
    ],
    tasks: [
      "Build a simple spreadsheet with the profit formula above.",
      "Fill it in for one candidate product with real supplier numbers.",
      "Calculate and memorise your break-even ROAS.",
    ],
    mistake: "Pricing 'competitively' at a 30% margin, then discovering ads eat 100% of that margin.",
    video: { title: "Unit economics, margin and break-even ROAS", query: "ecommerce unit economics margin break even ROAS explained" },
    quiz: {
      q: "Your gross margin is 50%. What is your break-even ROAS?",
      options: ["1.0", "1.5", "2.0", "4.0"],
      answer: 2,
      why: "Break-even ROAS = 1 ÷ margin. 1 ÷ 0.5 = 2.0, so you need $2 of revenue per $1 of ad spend just to break even.",
    },
  },
  {
    day: 3,
    week: 1,
    title: "Choosing a niche and a customer",
    goal: "Pick an audience specific enough that you know exactly what to say to them.",
    minutes: 40,
    sections: [
      {
        heading: "Niche beats 'general store'",
        body: "A general store has no reason to exist — Amazon already does that better. A niche store wins because the visitor thinks “this shop is for people like me”. Good niches have a passionate identity (runners, new parents, cat owners, home baristas), recurring problems, and people already spending money.",
      },
      {
        heading: "Write a real customer avatar",
        body: "Not 'women 25-45'. Write: “Melis, 32, works from home, back pain from a cheap chair, spends evenings on Instagram, has bought two ergonomic products before and both disappointed her.” Every ad, headline and product photo is written to that one person.",
      },
      {
        heading: "Passion + pain + payment power",
        body: "Score any niche on three things: is there emotion, is there a recurring painful problem, and can the audience afford a $40-100 purchase without thinking hard? If two of three are missing, move on.",
      },
    ],
    terms: [
      { term: "Niche", meaning: "A defined segment of the market with shared identity and needs." },
      { term: "Avatar / persona", meaning: "A written portrait of one specific ideal customer." },
      { term: "Positioning", meaning: "The reason a customer should choose you over the alternative." },
    ],
    tasks: [
      "Shortlist 3 niches and score each on passion / pain / payment power.",
      "Write a full customer avatar for the winner (name, age, day, frustration).",
      "Find 3 communities where that person already hangs out (subreddit, FB group, hashtag).",
    ],
    mistake: "Choosing a niche you find boring. You will produce content about it for months.",
    video: { title: "How to choose a profitable e-commerce niche", query: "how to choose profitable ecommerce niche 2024 beginners" },
    quiz: {
      q: "Which niche description is strong enough to build a store around?",
      options: [
        "Home and lifestyle products",
        "Gadgets for everyone",
        "Recovery tools for amateur runners training for their first marathon",
        "Cheap items under $10",
      ],
      answer: 2,
      why: "It names a specific person, a specific moment and a specific pain — which makes advertising and copywriting far easier.",
    },
  },
  {
    day: 4,
    week: 1,
    title: "Finding winning products",
    goal: "Learn the concrete criteria that separate a winner from a money pit.",
    minutes: 50,
    sections: [
      {
        heading: "The nine-point checklist",
        body: "A strong product: solves a visible problem; is hard to find in local shops; has a 'wow' moment that shows in 3 seconds of video; is light and hard to break (cheap shipping, few returns); costs you under ~$20; can sell for 3× that; has no serious safety/legal issues; is not seasonal-only; and has room for a bundle or upsell later.",
      },
      {
        heading: "Where to look",
        body: "TikTok and Reels for what is spreading right now; Amazon Movers & Shakers and 'frequently bought together'; AliExpress/CJ weekly best sellers; Etsy for emerging aesthetics; and competitor stores' 'best selling' collection. Use this app's Product Finder to shortlist, then verify manually — never buy a product because one tool said so.",
      },
      {
        heading: "Products to avoid as a beginner",
        body: "Electronics with warranty claims, anything ingestible or applied to skin, fragile glass/ceramics, heavy furniture, branded/counterfeit items, and totally saturated commodities like plain phone cases. The margin is never worth the support tickets.",
      },
    ],
    terms: [
      { term: "Wow factor", meaning: "The visual moment that makes a scroller stop." },
      { term: "Saturation", meaning: "So many sellers that ad costs exceed the margin." },
      { term: "Impulse price band", meaning: "$25-80, where people buy without long research." },
    ],
    tasks: [
      "Collect 10 candidate products in a spreadsheet.",
      "Score each against the nine-point checklist.",
      "Save your top 3 to My Library in this app.",
    ],
    mistake: "Falling in love with the first product. Always compare at least ten.",
    video: { title: "How to find winning products", query: "how to find winning dropshipping products research method" },
    quiz: {
      q: "Which attribute matters most for keeping advertising costs low?",
      options: ["Bright packaging", "A 3-second visual wow moment", "Many colour options", "A long product description"],
      answer: 1,
      why: "Paid social is won or lost in the first three seconds. A product that demonstrates itself visually gets cheap attention.",
    },
  },
  {
    day: 5,
    week: 1,
    title: "Validating demand with evidence",
    goal: "Prove other people want this before you spend money on it.",
    minutes: 40,
    sections: [
      {
        heading: "Three independent signals",
        body: "1) Social proof of momentum: videos from the last 30 days with high engagement, not a viral clip from 2021. 2) Search demand: Google Trends showing flat-or-rising interest, plus real monthly search volume for the product term. 3) Money already moving: active competitor ads (Meta Ad Library, TikTok Creative Center) and growing review counts on marketplaces. Require at least two of three.",
      },
      {
        heading: "Read competitor ads properly",
        body: "In the Meta Ad Library, filter by country and look for ads that have been running 3+ weeks with multiple creative variants. Nobody keeps paying for a losing ad — longevity is the strongest proof of profitability you can get for free.",
      },
      {
        heading: "Cheap validation tests",
        body: "Before a full store: post 3 organic videos of the product and watch retention; run a $50 traffic test to a single landing page; or list it on a marketplace for a week. Real click and add-to-cart behaviour beats any opinion.",
      },
    ],
    terms: [
      { term: "Meta Ad Library", meaning: "Free public archive of ads currently running on Facebook/Instagram." },
      { term: "Validation", meaning: "Evidence from strangers' behaviour, not friends' opinions." },
      { term: "Seasonality", meaning: "Predictable rise and fall of demand across the year." },
    ],
    tasks: [
      "Check Google Trends for your product term (12-month view).",
      "Find 3 competitor ads that have been live 3+ weeks; screenshot them.",
      "Open the Viral Ads tab in this app and study the top-performing formats.",
    ],
    mistake: "Asking friends and family. They are polite; strangers with credit cards are honest.",
    video: { title: "Validating product demand with the Meta Ad Library", query: "how to use facebook meta ad library product research validation" },
    quiz: {
      q: "A competitor has run the same ad for six weeks. What does that most likely mean?",
      options: ["They forgot to turn it off", "The ad is profitable", "The product is out of stock", "They are new"],
      answer: 1,
      why: "Ad accounts bleed money fast. Long-running ads are almost always ones that make more than they cost.",
    },
  },
  {
    day: 6,
    week: 1,
    title: "Suppliers, samples and shipping",
    goal: "Choose a supplier who will not destroy your reputation.",
    minutes: 45,
    sections: [
      {
        heading: "How to shortlist",
        body: "Contact at least five suppliers (AliExpress top-rated sellers, CJ Dropshipping, Alibaba for bulk, or a local wholesaler). Ask each: unit price at 1/50/500 units, processing time, shipping method and realistic delivery window, defect and return policy, whether they support custom packaging. Response speed and clarity tell you more than price.",
      },
      {
        heading: "Always order a sample",
        body: "Order the product to yourself from your top three suppliers. Judge: build quality, packaging, how long it really took, and whether it matches the photos. You also get authentic footage for your ads — a sample pays for itself twice.",
      },
      {
        heading: "Shipping expectations",
        body: "Long delivery times are survivable if you are honest about them. Publish the real window on the product page, send tracking within 48 hours, and email at day 7 with a status update. Silence, not slowness, causes chargebacks.",
      },
    ],
    terms: [
      { term: "MOQ", meaning: "Minimum Order Quantity a supplier will accept." },
      { term: "Lead time", meaning: "Days from order to dispatch (processing) plus transit." },
      { term: "Chargeback", meaning: "A customer reversing a payment through their bank — expensive." },
    ],
    tasks: [
      "Message 5 suppliers with the same question list; compare replies.",
      "Order samples from your top 2.",
      "Write your real delivery window in plain language for the product page.",
    ],
    mistake: "Picking the cheapest supplier. A $1 saving on unit cost is erased by one refund.",
    video: { title: "Finding and vetting suppliers", query: "how to find reliable dropshipping suppliers aliexpress alibaba vetting" },
    quiz: {
      q: "What is the single best reason to order a sample?",
      options: [
        "To confirm quality and get authentic ad footage",
        "To get a discount",
        "To test the checkout",
        "Samples are unnecessary",
      ],
      answer: 0,
      why: "You verify what your customer will actually receive, and you gain original video/photo assets you own.",
    },
  },
  {
    day: 7,
    week: 1,
    title: "Legal, tax and payments",
    goal: "Set up the boring foundations so you can accept money safely.",
    minutes: 35,
    sections: [
      {
        heading: "Business registration",
        body: "In most countries, occasional sales are tolerated but regular trading requires a registered business (sole trader / sole proprietorship is usually the fastest and cheapest form). Register before you scale, not after your first tax notice. Ask a local accountant for one hour of advice — it is the cheapest money you will spend.",
      },
      {
        heading: "Pages your store legally needs",
        body: "Terms of sale, privacy policy (GDPR/KVKK style consent if you serve the EU/Türkiye), refund and cancellation policy, shipping policy, and contact details with a real address. Payment processors reject stores that lack these.",
      },
      {
        heading: "Getting paid",
        body: "Use an established processor (Stripe, PayPal, or a local provider). Expect roughly 2-4% in fees. Keep a reserve: processors can hold funds when refund rates spike, so never spend 100% of revenue on ads.",
      },
    ],
    terms: [
      { term: "Sole trader", meaning: "The simplest legal form for a one-person business." },
      { term: "VAT / sales tax", meaning: "Consumption tax you may need to collect and remit." },
      { term: "Rolling reserve", meaning: "Money the payment processor holds back against refunds." },
    ],
    tasks: [
      "Check your country's threshold for registering a business.",
      "Draft the four required policy pages.",
      "Open or verify a payment processor account.",
    ],
    mistake: "Launching ads with no refund policy page — processors flag the store and freeze payouts.",
    video: { title: "Legal and tax basics for online stores", query: "ecommerce legal requirements tax basics online store beginners" },
    quiz: {
      q: "Why should you not spend all incoming revenue on ads immediately?",
      options: [
        "Ads are always unprofitable",
        "Processors may hold funds and refunds still need paying",
        "Banks forbid it",
        "It has no effect",
      ],
      answer: 1,
      why: "Payment providers can hold a reserve, and refunds come out of your pocket — cash-flow discipline keeps you alive.",
    },
  },
  {
    day: 8,
    week: 2,
    title: "Choosing your platform and setting up",
    goal: "Have a live store skeleton by the end of the day.",
    minutes: 60,
    sections: [
      {
        heading: "Which platform",
        body: "Shopify: fastest path, huge app ecosystem, monthly fee. WooCommerce: free software, you manage hosting and updates. Marketplaces (Amazon, Etsy, Trendyol): built-in traffic, but you rent the customer and compete on price. Social-only (Instagram + WhatsApp): zero cost, good for a first ten sales, no data ownership. Beginners: test on a marketplace or socials, build the brand on your own store.",
      },
      {
        heading: "The minimum viable store",
        body: "You need exactly: a home page that states what you sell in one line, one excellent product page, cart and checkout, the four policy pages, an About page with a human face, and a contact method. Nothing else. Ship it today; polish later.",
      },
      {
        heading: "Domain and identity",
        body: "Short, pronounceable, .com if possible. Avoid hyphens and numbers. Add a simple logo, one brand colour, and consistent product photography. Trust is built by consistency, not by expensive design.",
      },
    ],
    terms: [
      { term: "Theme", meaning: "The template controlling your store's layout and design." },
      { term: "Checkout", meaning: "The payment flow — the most conversion-sensitive part of the store." },
      { term: "MVP", meaning: "Minimum Viable Product — the smallest version that can make a sale." },
    ],
    tasks: [
      "Register a domain and create the store account.",
      "Install a clean free theme; set brand colour and logo.",
      "Publish the four policy pages and one product page.",
    ],
    mistake: "Spending three weeks on theme customisation before ever testing whether anyone wants the product.",
    video: { title: "Shopify store setup step by step", query: "shopify store setup tutorial step by step beginners full" },
    quiz: {
      q: "What is the biggest risk of selling only on a marketplace?",
      options: [
        "You cannot accept payments",
        "You do not own the customer relationship or data",
        "It is illegal",
        "There is no traffic",
      ],
      answer: 1,
      why: "Marketplaces bring traffic but keep the customer. Without your own list you rebuy every sale forever.",
    },
  },
  {
    day: 9,
    week: 2,
    title: "The offer — why they buy from you",
    goal: "Turn a product into an offer people feel silly refusing.",
    minutes: 45,
    sections: [
      {
        heading: "Product ≠ offer",
        body: "The product is the object. The offer is product + price + bonus + guarantee + urgency + delivery promise. Two stores selling the identical item can have wildly different conversion rates purely because one built an offer.",
      },
      {
        heading: "The building blocks",
        body: "Risk reversal: a 30-day money-back guarantee removes the main objection. Bundling: 'buy 2, get 1 free' raises AOV without more ad spend. Free shipping threshold: set it ~25% above your current AOV. Scarcity: only if it is true — fake countdown timers destroy trust. Bonus: a free digital guide costs you nothing and adds perceived value.",
      },
      {
        heading: "Pricing psychology",
        body: "Anchor with a higher 'compare-at' price only if it is genuine. Charm pricing ($49 vs $50) still works. Offer three tiers — most people take the middle. Never compete on being cheapest; you cannot outspend a bigger store on ads with a smaller margin.",
      },
    ],
    terms: [
      { term: "Risk reversal", meaning: "Shifting purchase risk from the buyer to you (guarantee)." },
      { term: "Bundle", meaning: "Multiple units or complementary items sold together." },
      { term: "Anchor price", meaning: "A reference price that makes your price look reasonable." },
    ],
    tasks: [
      "Write your offer in one paragraph including guarantee and bonus.",
      "Set a free-shipping threshold ~25% above your target AOV.",
      "Create one bundle option (2-pack or product + accessory).",
    ],
    mistake: "Using a fake 'only 3 left' timer. Customers recognise it instantly and bounce.",
    video: { title: "How to build an irresistible offer", query: "how to create irresistible offer ecommerce value stack guarantee" },
    quiz: {
      q: "Which change usually raises average order value with no extra ad spend?",
      options: ["Lowering the price", "A bundle plus a free-shipping threshold", "Adding more product photos", "Changing the logo"],
      answer: 1,
      why: "Bundles and thresholds get each existing buyer to spend more, which improves profitability without new traffic.",
    },
  },
  {
    day: 10,
    week: 2,
    title: "The product page that converts",
    goal: "Build a page structured around objections, not decoration.",
    minutes: 55,
    sections: [
      {
        heading: "The proven structure",
        body: "Above the fold: benefit-led headline, price, one strong image or video, and the Add to Cart button. Then: 3-5 benefit bullets (not specs), a short demo video, social proof (reviews with photos), how-it-works in 3 steps, comparison against the alternative, FAQ answering the top 6 objections, guarantee and shipping info, and a final Add to Cart. One page, one action.",
      },
      {
        heading: "Copy that sells",
        body: "Write benefits, not features. '5000mAh battery' is a feature; 'works all weekend without a charger' is a benefit. Use the customer's own words — copy phrases straight from competitor reviews. Keep sentences short. Address the objection immediately after the claim that triggers it.",
      },
      {
        heading: "Images and speed",
        body: "You need at least: one white-background hero, one in-use lifestyle shot, one scale reference, one detail close-up, one packaging shot, and a short looping demo. Compress everything — a page that loads in over 3 seconds loses roughly half of mobile visitors. Design mobile-first; that is where 80% of your traffic will come from.",
      },
    ],
    terms: [
      { term: "Above the fold", meaning: "What is visible before the user scrolls." },
      { term: "Social proof", meaning: "Evidence others already bought and were happy." },
      { term: "Bounce rate", meaning: "Share of visitors who leave without interacting." },
    ],
    tasks: [
      "Write 5 benefit bullets and a 6-question FAQ.",
      "Use the SEO & Marketing tab here to generate title, description and FAQ drafts.",
      "Test the page on your phone and time the load speed.",
    ],
    mistake: "A beautiful desktop page that is unusable on mobile, where nearly all of your traffic lives.",
    video: { title: "High-converting product page anatomy", query: "high converting shopify product page structure copywriting tutorial" },
    quiz: {
      q: "Which is a benefit rather than a feature?",
      options: ["Stainless steel body", "Works all weekend without a charger", "5000mAh battery", "IP67 rated"],
      answer: 1,
      why: "A benefit describes the improvement in the customer's life; features are the technical means to that end.",
    },
  },
  {
    day: 11,
    week: 2,
    title: "Content and organic traffic",
    goal: "Produce your first week of short-form videos without a studio.",
    minutes: 50,
    sections: [
      {
        heading: "Why organic first",
        body: "Short-form video is free advertising and a free testing lab. Whatever gets watched organically will almost certainly work as a paid ad — so you discover winning creative before spending money. Commit to 1-3 videos a day for 30 days; volume is the strategy.",
      },
      {
        heading: "The formats that work",
        body: "Problem → product → result. Before/after. 'Things I wish I knew before buying X'. Unboxing with a genuine reaction. POV skit. Satisfying demo loop. Customer testimonial. Rotate formats instead of reposting the same clip.",
      },
      {
        heading: "The first three seconds",
        body: "Open on movement plus a bold on-screen claim. No logo intros, no slow pans. Keep clips under 25 seconds at first, add captions (most people watch muted), and end with a soft direction ('link in bio') rather than a hard sell. Shoot vertical 9:16 in daylight; a phone is enough.",
      },
    ],
    terms: [
      { term: "Hook", meaning: "The first 1-3 seconds that decide whether the viewer stays." },
      { term: "Retention", meaning: "Percentage of the video an average viewer watches." },
      { term: "UGC", meaning: "User-Generated Content — authentic-looking creator footage." },
    ],
    tasks: [
      "Generate 3 scripts in the Creative Studio tab.",
      "Film and post 3 videos today across TikTok/Reels/Shorts.",
      "Log views, watch time and saves in your spreadsheet.",
    ],
    mistake: "Posting one video, getting 200 views, and concluding organic 'does not work'.",
    video: { title: "Short-form video hooks that stop the scroll", query: "tiktok hooks first 3 seconds ecommerce product video tutorial" },
    quiz: {
      q: "What is the main strategic value of organic short-form video for a new store?",
      options: [
        "It replaces the product page",
        "It is free traffic and a free creative testing lab",
        "It guarantees virality",
        "It improves supplier pricing",
      ],
      answer: 1,
      why: "You learn which hook and format your audience responds to before paying for reach.",
    },
  },
  {
    day: 12,
    week: 2,
    title: "Your first paid ads",
    goal: "Launch a structured $50-100 test that produces usable data.",
    minutes: 60,
    sections: [
      {
        heading: "Set up tracking first",
        body: "Install the Meta Pixel / TikTok Pixel and the Conversions API, verify your domain, and confirm that ViewContent, AddToCart, InitiateCheckout and Purchase all fire. Ads without tracking are gambling — the algorithm cannot optimise for an event it never sees.",
      },
      {
        heading: "The beginner test structure",
        body: "One campaign, objective = Conversions/Purchase. One broad ad set (your country, 18-65, no interest stacking — modern algorithms find the audience). Inside it, 3-5 different creatives. Budget $20-30/day. Let it run 3 full days untouched: every edit restarts the learning phase.",
      },
      {
        heading: "Reading the result",
        body: "Judge creatives, not the product, in the first test. Kill creatives with CTR under ~1%. Keep any creative with cost-per-add-to-cart below roughly a third of your product price. If one creative produces sales at or above break-even ROAS, you have a winner — duplicate it and slowly scale.",
      },
    ],
    terms: [
      { term: "Pixel", meaning: "Tracking code that reports visitor actions back to the ad platform." },
      { term: "Learning phase", meaning: "Period where the algorithm gathers data; edits reset it." },
      { term: "CTR", meaning: "Click-Through Rate — clicks ÷ impressions. Above ~1.5% is healthy." },
      { term: "CPM", meaning: "Cost per 1000 impressions — a proxy for audience competition." },
    ],
    tasks: [
      "Install and verify your pixel; complete a test purchase.",
      "Launch one campaign with 3-5 creatives at $20-30/day.",
      "Do not touch it for 72 hours; then record CTR, CPC, ATC and ROAS.",
    ],
    mistake: "Turning ads off after 6 hours because there were no sales yet. You bought data — read it first.",
    video: { title: "Facebook ads for beginners: first campaign setup", query: "facebook ads beginners tutorial first campaign shopify setup testing" },
    quiz: {
      q: "Why should you avoid editing an ad set during its first 3 days?",
      options: [
        "Editing costs money",
        "It resets the learning phase and wastes the data",
        "The platform bans edits",
        "It changes your billing date",
      ],
      answer: 1,
      why: "Significant edits restart the learning phase, so the algorithm loses the optimisation progress you paid for.",
    },
  },
  {
    day: 13,
    week: 2,
    title: "Reading the funnel and fixing the leak",
    goal: "Diagnose exactly where visitors drop off instead of guessing.",
    minutes: 45,
    sections: [
      {
        heading: "The four-step funnel",
        body: "Impression → Click → Add to Cart → Purchase. Each step has a healthy benchmark: CTR above ~1.5%, add-to-cart rate around 5-10% of visitors, checkout-to-purchase above ~50%, overall conversion rate 1-3%. Compare your numbers against these to locate the leak.",
      },
      {
        heading: "Diagnosis table",
        body: "Low CTR → the creative or hook is weak, not the product. High CTR but few add-to-carts → the product page, price or offer mismatches the ad promise. Many add-to-carts but few checkouts → shipping cost shock, or too few payment options. Checkout started but not completed → forced account creation, slow page, or a broken payment method on mobile.",
      },
      {
        heading: "Fix one thing at a time",
        body: "Change a single variable, wait for at least 100 visitors or 3 days, then measure. Use heatmaps or session recordings if you can — watching five real sessions usually reveals more than a week of theorising.",
      },
    ],
    terms: [
      { term: "Funnel", meaning: "The sequence of steps from first view to purchase." },
      { term: "Conversion rate", meaning: "Purchases ÷ sessions, expressed as a percentage." },
      { term: "Cart abandonment", meaning: "Adding to cart but leaving without paying." },
    ],
    tasks: [
      "Write down your four funnel numbers from the last 3 days.",
      "Identify the single weakest step versus the benchmark.",
      "Make one change to fix it and schedule a re-check in 72 hours.",
    ],
    mistake: "Changing the creative, the price and the page on the same day — now you cannot tell what helped.",
    video: { title: "Diagnosing your e-commerce conversion funnel", query: "ecommerce conversion funnel analysis fix low conversion rate shopify" },
    quiz: {
      q: "High CTR but almost no add-to-carts. Where do you look first?",
      options: ["The ad creative", "The product page, price and offer", "The pixel", "The supplier"],
      answer: 1,
      why: "The creative already did its job by earning clicks; the disconnect is what visitors find after arriving.",
    },
  },
  {
    day: 14,
    week: 3,
    title: "Retention: email, SMS and repeat buyers",
    goal: "Stop paying for the same customer twice.",
    minutes: 45,
    sections: [
      {
        heading: "Why retention decides profitability",
        body: "Acquiring a customer costs money; selling to them again is nearly free. A store with 25% repeat purchases can outbid a competitor on ads and still profit. Retention is the quiet advantage that lets you scale.",
      },
      {
        heading: "The four flows to build first",
        body: "1) Welcome flow (3 emails) for new subscribers with a small first-order incentive. 2) Abandoned cart (3 messages at 1h, 24h, 72h) — usually the single highest-revenue automation. 3) Post-purchase: shipping updates, care instructions, and a review request around day 10. 4) Win-back at 45-60 days of inactivity.",
      },
      {
        heading: "Reviews and community",
        body: "Ask every buyer for a photo review and offer a small credit for it. Publish reviews on the product page. Invite buyers to a private group or newsletter where you show new products first — those people become your cheapest launch channel.",
      },
    ],
    terms: [
      { term: "Flow / automation", meaning: "A pre-built message sequence triggered by behaviour." },
      { term: "LTV", meaning: "Lifetime Value — total profit from one customer over time." },
      { term: "Win-back", meaning: "A campaign targeting customers who stopped buying." },
    ],
    tasks: [
      "Add an email capture popup with a real incentive.",
      "Build the abandoned-cart flow (3 messages).",
      "Set an automatic review request 10 days after delivery.",
    ],
    mistake: "Collecting emails for months and never sending anything. An unused list decays fast.",
    video: { title: "Email marketing flows for e-commerce", query: "klaviyo email flows ecommerce abandoned cart welcome series tutorial" },
    quiz: {
      q: "Which automation typically recovers the most revenue for a new store?",
      options: ["Birthday email", "Abandoned cart sequence", "Monthly newsletter", "Win-back campaign"],
      answer: 1,
      why: "Abandoned-cart messages reach people who already chose the product, so intent is highest.",
    },
  },
  {
    day: 15,
    week: 3,
    title: "Scaling and building a real brand",
    goal: "Turn a working test into a business that keeps growing.",
    minutes: 50,
    sections: [
      {
        heading: "When you are allowed to scale",
        body: "Only after: consistent ROAS above break-even for 7+ days, refund rate under ~5%, reliable supplier stock, and support you can actually answer. Scaling a broken operation just multiplies the problems.",
      },
      {
        heading: "How to scale without breaking the account",
        body: "Vertical: increase the winning ad set's budget by 20-30% every 2-3 days. Horizontal: duplicate the winner into new audiences, new placements, new countries. Creative: produce 3-5 new variations of the winning angle weekly — creative fatigue, not audience size, is what kills most campaigns.",
      },
      {
        heading: "From store to brand",
        body: "Add complementary products so each customer can buy 3-4 times. Move to custom packaging and an insert card. Build a recognisable visual identity and voice. Track five numbers weekly: revenue, ROAS, AOV, conversion rate and repeat rate. Then repeat this entire 15-day cycle for your next product — the process is the asset, not any single product.",
      },
    ],
    terms: [
      { term: "Vertical scaling", meaning: "Raising budget on an existing winning ad set." },
      { term: "Horizontal scaling", meaning: "Duplicating winners into new audiences or markets." },
      { term: "Creative fatigue", meaning: "Performance decay as an audience sees the same ad repeatedly." },
    ],
    tasks: [
      "Define your scaling rule in writing (e.g. '+25% budget if 3-day ROAS > 2.2').",
      "Plan 3 new creative variants of your best-performing angle.",
      "Set a weekly 30-minute review of your five core metrics.",
    ],
    mistake: "Multiplying budget 10× overnight. The learning phase resets and costs explode.",
    video: { title: "Scaling e-commerce ads profitably", query: "how to scale facebook ads profitably ecommerce vertical horizontal scaling" },
    quiz: {
      q: "What most often causes a winning ad to stop performing after a few weeks?",
      options: ["The product expires", "Creative fatigue", "The pixel breaks", "Competitors report you"],
      answer: 1,
      why: "The same audience keeps seeing the same creative, engagement falls and costs rise — so you refresh creative continuously.",
    },
  },
];

const WEEKS: { id: 1 | 2 | 3; title: string; blurb: string }[] = [
  { id: 1, title: "Week 1 — Foundations & Product", blurb: "Days 1-7: how the business works, the maths, your niche, product and suppliers." },
  { id: 2, title: "Week 2 — Store, Offer & Traffic", blurb: "Days 8-13: build the store, craft the offer, create content and run your first ads." },
  { id: 3, title: "Week 3 — Keep & Grow", blurb: "Days 14-15: retention systems and profitable scaling." },
];

const TOTAL_TASKS = DAYS.reduce((n, d) => n + d.tasks.length, 0);
const STORE_KEY = "education-progress-v2";

type Saved = { tasks: Record<string, boolean>; answers: Record<number, number> };

export function AcademyTab() {
  const [tasksDone, setTasksDone] = useState<Record<string, boolean>>({});
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [openDay, setOpenDay] = useState<number | null>(1);
  const [videoOpen, setVideoOpen] = useState<number | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const p = JSON.parse(raw) as Partial<Saved>;
        setTasksDone(p.tasks ?? {});
        setAnswers(p.answers ?? {});
      }
    } catch { /* ignore */ }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ tasks: tasksDone, answers })); } catch { /* ignore */ }
  }, [tasksDone, answers, hydrated]);

  const doneCount = useMemo(() => Object.values(tasksDone).filter(Boolean).length, [tasksDone]);
  const pct = Math.round((doneCount / TOTAL_TASKS) * 100);
  const quizzesPassed = DAYS.filter(d => answers[d.day] === d.quiz.answer).length;

  const dayComplete = (d: Day) =>
    d.tasks.every((_, i) => tasksDone[`${d.day}-${i}`]) && answers[d.day] === d.quiz.answer;
  const completedDays = DAYS.filter(dayComplete).length;

  const toggleTask = (key: string) => setTasksDone(p => ({ ...p, [key]: !p[key] }));
  const reset = () => { setTasksDone({}); setAnswers({}); setOpenDay(1); setVideoOpen(null); };

  return (
    <section className="max-w-4xl mx-auto">
      <div className="text-center mb-6">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-muted-foreground mb-3">
          <GraduationCap size={13} /> 15-Day Interactive Program
        </div>
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
          E-Commerce <span className="text-gradient">From Zero</span>
        </h1>
        <p className="text-muted-foreground mt-2 text-sm md:text-base max-w-2xl mx-auto">
          A complete beginner course: one lesson a day for 15 days. Every day includes a written lesson,
          key terms, a video, action tasks and a short quiz. Your progress is saved automatically.
        </p>
      </div>

      <div className="glass rounded-2xl p-5 mb-6 border border-[oklch(0.68_0.20_265)]/25">
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 shrink-0 rounded-lg bg-gradient-to-br from-[oklch(0.68_0.20_265)]/25 to-[oklch(0.66_0.24_305)]/25 flex items-center justify-center">
            <MessageSquare size={16} className="text-[oklch(0.85_0.15_265)]" />
          </div>
          <div className="min-w-0">
            <h2 className="font-semibold text-sm">Feedback</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Want to share feedback, report a problem or suggest a lesson? Send us an email at{" "}
              <a
                href="mailto:mk65449191@gmail.com?subject=Velora%20Feedback"
                className="font-semibold text-[oklch(0.85_0.15_265)] hover:underline"
              >
                mk65449191@gmail.com
              </a>{" "}
              — we read every message.
            </p>
            <a
              href="mailto:mk65449191@gmail.com?subject=Velora%20Feedback"
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 px-3 py-1.5 text-xs font-semibold"
            >
              <MessageSquare size={12} /> Send feedback
            </a>
          </div>
        </div>
      </div>



      <div className="glass rounded-2xl p-5 mb-6">
        <div className="flex items-center justify-between text-sm mb-2">
          <span className="font-semibold">Your progress</span>
          <span className="text-muted-foreground">
            {completedDays}/{DAYS.length} days · {doneCount}/{TOTAL_TASKS} tasks · {quizzesPassed}/{DAYS.length} quizzes
          </span>
        </div>
        <div className="h-2.5 rounded-full bg-white/10 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-[oklch(0.68_0.20_265)] to-[oklch(0.66_0.24_305)] transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex items-center justify-between mt-3">
          <span className="text-xs text-muted-foreground">
            {pct === 100 ? "All tasks complete — outstanding work." : `${pct}% complete`}
          </span>
          <button onClick={reset} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
            <RotateCcw size={12} /> Reset progress
          </button>
        </div>
      </div>

      {completedDays === DAYS.length && (
        <div className="glass rounded-2xl p-5 mb-6 border border-[oklch(0.85_0.18_90)]/40 flex items-center gap-3">
          <Trophy size={22} className="text-[oklch(0.85_0.18_90)]" />
          <div>
            <p className="font-semibold text-sm">Program completed</p>
            <p className="text-xs text-muted-foreground">You now have the full loop. Run it again with your next product.</p>
          </div>
        </div>
      )}

      <div className="space-y-8">
        {WEEKS.map((w) => (
          <div key={w.id}>
            <div className="mb-3 px-1">
              <h2 className="text-lg font-bold">{w.title}</h2>
              <p className="text-xs text-muted-foreground">{w.blurb}</p>
            </div>

            <div className="space-y-3">
              {DAYS.filter(d => d.week === w.id).map((d) => {
                const isOpen = openDay === d.day;
                const answered = answers[d.day];
                const correct = answered === d.quiz.answer;
                const tDone = d.tasks.filter((_, i) => tasksDone[`${d.day}-${i}`]).length;
                const finished = dayComplete(d);

                return (
                  <div key={d.day} className="glass rounded-2xl overflow-hidden">
                    <button
                      onClick={() => setOpenDay(isOpen ? null : d.day)}
                      className="w-full flex items-center gap-3 p-4 text-left hover:bg-white/5 transition"
                      aria-expanded={isOpen}
                    >
                      <span className={`shrink-0 grid place-items-center size-11 rounded-xl border text-sm font-bold ${finished ? "border-[oklch(0.75_0.19_150)]/50 bg-[oklch(0.75_0.19_150)]/15" : "border-white/10 bg-gradient-to-br from-[oklch(0.68_0.20_265)]/25 to-[oklch(0.66_0.24_305)]/25"}`}>
                        {finished ? <Check size={18} className="text-[oklch(0.75_0.19_150)]" /> : d.day}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block font-semibold text-sm truncate">Day {d.day} — {d.title}</span>
                        <span className="block text-xs text-muted-foreground line-clamp-1">{d.goal}</span>
                      </span>
                      <span className="hidden sm:inline shrink-0 text-[11px] text-muted-foreground">~{d.minutes} min</span>
                      <span className="shrink-0 text-[11px] rounded-full bg-white/10 px-2 py-0.5">{tDone}/{d.tasks.length}</span>
                      <ChevronDown size={16} className={`shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                    </button>

                    {isOpen && (
                      <div className="px-4 pb-5 space-y-4">
                        {/* Lesson */}
                        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-3.5">
                          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            <BookOpen size={13} /> Lesson
                          </p>
                          {d.sections.map((s) => (
                            <div key={s.heading}>
                              <p className="text-sm font-semibold">{s.heading}</p>
                              <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{s.body}</p>
                            </div>
                          ))}
                        </div>

                        {/* Key terms */}
                        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2.5">Key terms</p>
                          <dl className="grid sm:grid-cols-2 gap-2.5">
                            {d.terms.map((t) => (
                              <div key={t.term} className="rounded-lg bg-white/5 border border-white/10 p-2.5">
                                <dt className="text-xs font-semibold">{t.term}</dt>
                                <dd className="text-xs text-muted-foreground mt-0.5">{t.meaning}</dd>
                              </div>
                            ))}
                          </dl>
                        </div>

                        {/* Video */}
                        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                          <div className="flex items-start justify-between gap-3 flex-wrap">
                            <div className="min-w-0">
                              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                <PlayCircle size={13} /> Watch
                              </p>
                              <p className="text-sm mt-1">{d.video.title}</p>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => setVideoOpen(videoOpen === d.day ? null : d.day)}
                                className="rounded-lg bg-gradient-to-r from-[oklch(0.68_0.20_265)] to-[oklch(0.66_0.24_305)] px-3 py-1.5 text-xs font-semibold"
                              >
                                {videoOpen === d.day ? "Hide video" : "Play video"}
                              </button>
                              <a
                                href={`https://www.youtube.com/results?search_query=${encodeURIComponent(d.video.query)}`}
                                target="_blank" rel="noreferrer"
                                className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10"
                              >
                                YouTube <ExternalLink size={11} />
                              </a>
                            </div>
                          </div>
                          {videoOpen === d.day && (
                            <div className="mt-3 aspect-video w-full overflow-hidden rounded-lg border border-white/10 bg-black">
                              <iframe
                                className="w-full h-full"
                                src={`https://www.youtube.com/embed?listType=search&list=${encodeURIComponent(d.video.query)}`}
                                title={d.video.title}
                                allow="accelerometer; clipboard-write; encrypted-media; picture-in-picture"
                                allowFullScreen
                                loading="lazy"
                              />
                            </div>
                          )}
                        </div>

                        {/* Tasks */}
                        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                            <ListChecks size={13} /> Today&apos;s tasks
                          </p>
                          <div className="space-y-2">
                            {d.tasks.map((task, i) => {
                              const key = `${d.day}-${i}`;
                              const on = !!tasksDone[key];
                              return (
                                <button
                                  key={key}
                                  onClick={() => toggleTask(key)}
                                  className={`w-full flex items-start gap-2.5 text-left rounded-lg border p-2.5 transition ${on ? "border-[oklch(0.75_0.19_150)]/40 bg-[oklch(0.75_0.19_150)]/10" : "border-white/10 hover:bg-white/5"}`}
                                >
                                  {on
                                    ? <Check size={16} className="mt-0.5 shrink-0 text-[oklch(0.75_0.19_150)]" />
                                    : <CircleDashed size={16} className="mt-0.5 shrink-0 text-muted-foreground" />}
                                  <span className={`text-sm ${on ? "text-muted-foreground line-through" : ""}`}>{task}</span>
                                </button>
                              );
                            })}
                          </div>
                          <p className="mt-3 flex items-start gap-2 text-xs rounded-lg bg-white/5 border border-white/10 p-2.5">
                            <AlertTriangle size={13} className="mt-0.5 shrink-0 text-[oklch(0.80_0.16_60)]" />
                            <span><span className="font-semibold">Common mistake: </span>{d.mistake}</span>
                          </p>
                        </div>

                        {/* Quiz */}
                        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                            <Lightbulb size={13} /> Quick check
                          </p>
                          <p className="text-sm font-semibold mb-3">{d.quiz.q}</p>
                          <div className="grid gap-2">
                            {d.quiz.options.map((opt, i) => {
                              const chosen = answered === i;
                              const state = answered === undefined
                                ? "border-white/10 hover:bg-white/5"
                                : i === d.quiz.answer
                                  ? "border-[oklch(0.75_0.19_150)]/50 bg-[oklch(0.75_0.19_150)]/10"
                                  : chosen
                                    ? "border-[oklch(0.68_0.20_25)]/50 bg-[oklch(0.68_0.20_25)]/10"
                                    : "border-white/10 opacity-60";
                              return (
                                <button
                                  key={i}
                                  onClick={() => setAnswers(p => ({ ...p, [d.day]: i }))}
                                  className={`text-left text-sm rounded-lg border px-3 py-2 transition ${state}`}
                                >
                                  {opt}
                                </button>
                              );
                            })}
                          </div>
                          {answered !== undefined && (
                            <div className="mt-3 text-xs text-muted-foreground">
                              <span className={`font-semibold ${correct ? "text-[oklch(0.75_0.19_150)]" : "text-[oklch(0.72_0.19_25)]"}`}>
                                {correct ? "Correct. " : "Not quite. "}
                              </span>
                              {d.quiz.why}
                              {!correct && (
                                <button
                                  onClick={() => setAnswers(p => { const n = { ...p }; delete n[d.day]; return n; })}
                                  className="ml-2 underline hover:text-foreground"
                                >
                                  try again
                                </button>
                              )}
                            </div>
                          )}
                        </div>

                        {d.day < DAYS.length && (
                          <button
                            onClick={() => { setOpenDay(d.day + 1); setVideoOpen(null); }}
                            className="w-full rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 px-3 py-2 text-xs font-semibold"
                          >
                            Continue to Day {d.day + 1} →
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
