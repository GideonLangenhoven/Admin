# Landing Pages — BookingTours

Auto-generated landing pages for each client business, deployed to Firebase Hosting.

## Templates

| Template | Style | Inspired By |
|----------|-------|-------------|
| **adventure** | Cinematic full-width hero, bold outdoor feel | [Iceland Travel](https://icelandtravel.is) |
| **luxury** | Elegant serif fonts, muted tones, minimal | [ZQ Collection](https://zqcollection.com) |
| **safari** | Warm earthy tones, lodge/safari feel | [Ichingo Lodge](https://ichingochoberiverlodge.com) |
| **modern** | Bold sans-serif, split hero, dark accents | [Kayak.co.za](https://kayak.co.za) |

## Generate a Landing Page

```bash
node landing-pages/generator/build.mjs \
  --data business.json \
  --template adventure \
  --out landing-pages/output/my-business
```

### business.json format

```json
{
  "business_name": "Atlantic Skydive Co.",
  "business_tagline": "Tandem skydiving over the Cape",
  "subdomain": "atlantic-skydive",
  "booking_site_url": "https://atlantic-skydive.bookingtours.co.za",
  "logo_url": "https://...",
  "hero_eyebrow": "Cape Town's Premier Skydiving",
  "hero_title": "Fall in love with the sky",
  "hero_subtitle": "Tandem skydiving from 10,000ft with panoramic ocean views",
  "hero_image": "https://...",
  "color_main": "#1a3c34",
  "color_secondary": "#132833",
  "color_cta": "#ca6c2f",
  "color_bg": "#f5f5f5",
  "color_nav": "#ffffff",
  "color_hover": "#48cfad",
  "currency": "R",
  "directions": "Meet at Cape Town Skydive Centre, Melkbosstrand",
  "what_to_bring": "Closed shoes, sunscreen, camera",
  "what_to_wear": "Comfortable clothing, no loose items",
  "footer_line_one": "Atlantic Skydive Co. — Cape Town",
  "footer_line_two": "info@atlanticskydive.co.za",
  "tours": [
    {
      "name": "Tandem Skydive",
      "description": "10,000ft freefall with certified instructor",
      "duration_minutes": "180",
      "default_capacity": "8",
      "base_price_per_person": "2800",
      "image_url": "https://..."
    }
  ]
}
```

## Deploy to Firebase

### First-time setup
```bash
npm install -g firebase-tools
firebase login
firebase projects:create bookingtours-sites
```

### Add a new site (one per client)
```bash
firebase hosting:sites:create atlantic-skydive --project bookingtours-sites
```

### Deploy
```bash
cd landing-pages/output/atlantic-skydive
firebase deploy --only hosting:atlantic-skydive --project bookingtours-sites
```

### Add custom domain
```bash
firebase hosting:sites:update atlantic-skydive --project bookingtours-sites
```
Then in Firebase Console → Hosting → atlantic-skydive → Custom domain → Add `www.atlanticskydive.co.za`

Firebase provides the DNS records to add:
- A record → Firebase IP
- TXT record → Verification

## Structure
```
landing-pages/
├── templates/
│   ├── adventure.html    ← Cinematic outdoor
│   ├── luxury.html       ← Elegant minimal
│   ├── safari.html       ← Warm lodge
│   └── modern.html       ← Bold split-hero
├── generator/
│   └── build.mjs         ← Template → static HTML
├── output/               ← Generated sites (gitignored)
├── firebase.json         ← Firebase hosting config
├── .firebaserc           ← Firebase project link
└── README.md
```
