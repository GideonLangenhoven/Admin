import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createServiceClient } from "../_shared/tenant.ts";
import { withSentry, captureException } from "../_shared/sentry.ts";

var db = createServiceClient();
var GOOGLE_PLACES_API_KEY = Deno.env.get("GOOGLE_PLACES_API_KEY") || "";

Deno.serve(withSentry("fetch-google-reviews", async (_req: Request) => {
  if (!GOOGLE_PLACES_API_KEY) {
    return new Response(JSON.stringify({ error: "GOOGLE_PLACES_API_KEY not set" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }

  var { data: businesses } = await db.from("businesses")
    .select("id, google_place_id")
    .not("google_place_id", "is", null);

  var totalUpserted = 0;

  for (var biz of businesses || []) {
    try {
      var res = await fetch(
        "https://places.googleapis.com/v1/places/" + biz.google_place_id,
        {
          headers: {
            "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
            "X-Goog-FieldMask": "reviews",
          },
        }
      );

      if (!res.ok) {
        console.error("Google Places API error for", biz.id, res.status, await res.text());
        continue;
      }

      var body = await res.json();
      var reviews = body.reviews || [];

      for (var review of reviews) {
        var googleReviewId = review.name;
        if (!googleReviewId) continue;

        var { error } = await db.from("reviews").upsert(
          {
            business_id: biz.id,
            source: "GOOGLE",
            status: "APPROVED",
            rating: review.rating || null,
            comment: review.text?.text || null,
            reviewer_name: review.authorAttribution?.displayName || null,
            reviewer_avatar_url: review.authorAttribution?.photoUri || null,
            google_review_id: googleReviewId,
            submitted_at: review.publishTime || new Date().toISOString(),
          },
          { onConflict: "google_review_id" }
        );

        if (error) {
          console.error("Upsert error for review", googleReviewId, error);
        } else {
          totalUpserted++;
        }
      }

      await db.from("businesses")
        .update({ google_reviews_last_synced_at: new Date().toISOString() })
        .eq("id", biz.id);

    } catch (err) {
      captureException(err);
      console.error("Error syncing reviews for business", biz.id, err);
    }
  }

  return new Response(
    JSON.stringify({ ok: true, businesses: (businesses || []).length, upserted: totalUpserted }),
    { headers: { "Content-Type": "application/json" } }
  );
}));
