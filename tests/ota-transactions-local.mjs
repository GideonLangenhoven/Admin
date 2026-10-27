import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import pg from "pg";
import load from "./helpers/ota-module.cjs";
import transport from "./helpers/ota-postgres.cjs";
const { syncSupplierAvailability } = load(
  "supabase/functions/_shared/ota-availability.ts",
);
const { createSupplierBackend } = load(
  "supabase/functions/_shared/ota-backend.ts",
);
const { createGygSupplierHandler } = load(
  "supabase/functions/_shared/getyourguide.ts",
);
const { createViatorSupplierHandler } = load(
  "supabase/functions/_shared/viator.ts",
);
const host = process.argv[2], port = Number(process.argv[3]);
assert(
  /^\/private\/tmp\/capekayak-db-test-[A-Za-z0-9]+$/.test(host || ""),
  "Disposable local socket required",
);
assert(Number.isInteger(port) && port > 1024 && port < 65536);
const database = "ota_fixture_" + randomBytes(8).toString("hex");
const config = {
  host,
  port,
  user: process.env.USER,
  connectionTimeoutMillis: 5000,
};
const admin = new pg.Client({ ...config, database: "postgres" }),
  db = new pg.Client({ ...config, database });
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let created = false, passed = 0;
const book = (ref, overrides = {}) => ({
  operation: "book",
  reference: ref,
  product: "P",
  option: "O",
  date: "2030-01-02",
  time: "10:00:00",
  quantity: 1,
  amount: 100,
  currency: "ZAR",
  customer_name: "Synthetic OTA fixture",
  ...overrides,
});
const call = (
  event,
  request,
  business = id(1),
  channel = "VIATOR",
  client = db,
) =>
  client.query("SELECT ota_apply_operation($1,$2,$3,$4,$5::jsonb) AS result", [
    business,
    channel,
    "SANDBOX",
    event,
    JSON.stringify(request),
  ]).then((r) => r.rows[0].result);
const fails = (event, request, error, business = id(1), channel = "VIATOR") =>
  assert.rejects(
    call(event, request, business, channel),
    (e) => e.message.includes(error),
  );
async function check(name, work) {
  await work();
  passed++;
  console.log("PASS " + name);
}
async function reset() {
  await db.query("TRUNCATE holds CASCADE");
  await db.query(
    "TRUNCATE ota_events,ota_reservations,bookings,customers CASCADE",
  );
  await db.query(
    "UPDATE slots SET booked=0,held=0,status='OPEN',capacity_total=5",
  );
}
const state = async (slot) =>
  (await db.query("SELECT booked,held FROM slots WHERE id=$1", [slot || id(4)]))
    .rows[0];
try {
  await admin.connect();
  await admin.query("CREATE DATABASE " + database);
  created = true;
  await db.connect();
  await db.query(readFileSync("tests/fixtures/rollout-schema.sql", "utf8"));
  await db.query(readFileSync("tests/fixtures/rollout-policies.sql", "utf8"));
  await db.query(
    readFileSync(
      "supabase/migrations/20260503180000_customers_table.sql",
      "utf8",
    ),
  );
  // Apply the original OTA table definitions without unrelated credential/cron deployment.
  const original = readFileSync(
    "supabase/migrations/20260504140000_ota_viator.sql",
    "utf8",
  );
  await db.query(original.slice(0, original.indexOf("-- RLS")) + "COMMIT;");
  await db.query(
    readFileSync(
      "supabase/migrations/20261008120000_ota_transactions.sql",
      "utf8",
    ),
  );
  const direct = readFileSync(
    "supabase/migrations/20260911130000_checkout_pricing.sql",
    "utf8",
  );
  await db.query(
    direct.slice(
      0,
      direct.indexOf(
        "CREATE OR REPLACE FUNCTION public.prepare_booking_checkout",
      ),
    ) + "COMMIT;",
  );
  await db.query(
    "INSERT INTO businesses(id,name,operator_email) VALUES($1,'OTA fixture','ota@example.invalid'),($2,'Other fixture','other@example.invalid')",
    [id(1), id(2)],
  );
  await db.query(
    "INSERT INTO tours(id,business_id,name,base_price_per_person,default_capacity) VALUES($1,$2,'Fixture A',100,5),($3,$2,'Fixture B',200,5),($4,$5,'Other tenant',100,5)",
    [id(3), id(1), id(5), id(6), id(2)],
  );
  await db.query(
    "INSERT INTO slots(id,business_id,tour_id,start_time,capacity_total) VALUES($1,$2,$3,'2030-01-02T08:00:00Z',5),($4,$2,$3,'2030-01-03T08:00:00Z',5),($5,$2,$6,'2030-01-03T09:00:00Z',5),($7,$8,$9,'2030-01-02T08:00:00Z',5)",
    [id(4), id(1), id(3), id(7), id(8), id(5), id(9), id(2), id(6)],
  );
  await db.query(
    "INSERT INTO ota_product_mappings(business_id,channel,tour_id,external_product_code,external_option_code,supplier_option_id) VALUES($1,'VIATOR',$2,'P','O','opt-a'),($1,'VIATOR',$3,'P2','O2','opt-b'),($4,'VIATOR',$5,'P','O','other-opt'),($1,'GETYOURGUIDE',$2,'GYG',NULL,NULL)",
    [id(1), id(3), id(5), id(2), id(6)],
  );
  await check(
    "candidate OTA queried schema matches executed migration",
    async () => {
      const expected = JSON.parse(
        readFileSync("tests/fixtures/ota-columns.local.json", "utf8"),
      );
      for (const [table, columns] of Object.entries(expected)) {
        const actual = (await db.query(
          "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1",
          [table],
        )).rows.map((r) => r.column_name);
        for (const column of columns) {
          assert(actual.includes(column), table + "." + column);
        }
      }
    },
  );
  await check(
    "migration blocks runtime and service-role activation",
    async () => {
      await fails("blocked", book("blocked"), "OTA_NOT_READY");
      await db.query("SET ROLE service_role");
      await assert.rejects(
        db.query("UPDATE ota_runtime_boundary SET environment='SANDBOX'"),
        (e) => e.code === "42501",
      );
      await db.query("RESET ROLE");
      await db.query("UPDATE ota_runtime_boundary SET environment='SANDBOX'");
    },
  );
  await check(
    "concurrent last-seat creates one booking and one event",
    async () => {
      await db.query("UPDATE slots SET capacity_total=1 WHERE id=$1", [id(4)]);
      const other = new pg.Client({ ...config, database });
      await other.connect();
      try {
        const results = await Promise.allSettled([
          call("race-a", book("race-a")),
          call("race-b", book("race-b"), id(1), "VIATOR", other),
        ]);
        assert.equal(
          results.filter((r) => r.status === "fulfilled").length,
          1,
          JSON.stringify(
            results.map((r) =>
              r.status === "rejected" ? r.reason.message : r.value
            ),
          ),
        );
        assert.deepEqual(await state(), { booked: 1, held: 0 });
        assert.equal(
          (await db.query("SELECT count(*)::int n FROM bookings")).rows[0].n,
          1,
        );
      } finally {
        await other.end();
      }
    },
  );
  await reset();
  await check(
    "duplicate creation returns exact result; conflict fails; tenant ref isolated",
    async () => {
      const result = await call("duplicate", book("same"));
      assert.deepEqual(await call("duplicate", book("same")), result);
      assert.deepEqual(await call("another-transport", book("same")), result);
      await fails(
        "duplicate",
        book("same", { quantity: 2 }),
        "IDEMPOTENCY_CONFLICT",
      );
      await fails(
        "transport",
        book("same", { quantity: 2 }),
        "IDEMPOTENCY_CONFLICT",
      );
      await call("other", book("same"), id(2));
      assert.deepEqual(await state(), { booked: 1, held: 0 });
    },
  );
  await reset();
  await check(
    "injected event completion failure rolls back booking, customer and capacity; same event retries",
    async () => {
      await db.query(
        "CREATE FUNCTION ota_fail_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected event write failure'; END $$; CREATE TRIGGER ota_fail BEFORE INSERT ON ota_events FOR EACH ROW EXECUTE FUNCTION ota_fail_event()",
      );
      await fails(
        "retry",
        book("retry", { email: "synthetic@example.invalid" }),
        "injected",
      );
      assert.deepEqual(await state(), { booked: 0, held: 0 });
      assert.equal(
        (await db.query("SELECT count(*)::int n FROM bookings")).rows[0].n,
        0,
      );
      assert.equal(
        (await db.query("SELECT count(*)::int n FROM customers")).rows[0].n,
        0,
      );
      await db.query("DROP TRIGGER ota_fail ON ota_events");
      await call(
        "retry",
        book("retry", { email: "synthetic@example.invalid" }),
      );
      assert.deepEqual(await state(), { booked: 1, held: 0 });
    },
  );
  await reset();
  await check(
    "date/product/option/quantity amendments move seats; later amendments and waived new guests",
    async () => {
      const result = await call("create", book("amend"));
      await db.query("UPDATE bookings SET waiver_status='SIGNED' WHERE id=$1", [
        result.booking_id,
      ]);
      await call(
        "amend1",
        book("amend", {
          operation: "amend",
          supplier_reference: result.booking_id,
          date: "2030-01-03",
          quantity: 2,
        }),
      );
      assert.deepEqual(await state(), { booked: 0, held: 0 });
      assert.deepEqual(await state(id(7)), { booked: 2, held: 0 });
      await call(
        "amend2",
        book("amend", {
          operation: "amend",
          supplier_reference: result.booking_id,
          product: "P2",
          option: "O2",
          date: "2030-01-03",
          time: "11:00:00",
          quantity: 3,
        }),
      );
      assert.deepEqual(await state(id(7)), { booked: 0, held: 0 });
      assert.deepEqual(await state(id(8)), { booked: 3, held: 0 });
      assert.equal(
        (await db.query("SELECT waiver_status FROM bookings WHERE id=$1", [
          result.booking_id,
        ])).rows[0].waiver_status,
        "PENDING",
      );
      await call("cancel", {
        operation: "cancel",
        reference: "amend",
        supplier_reference: result.booking_id,
      });
      await call("cancel2", {
        operation: "cancel",
        reference: "amend",
        supplier_reference: result.booking_id,
      });
      assert.deepEqual(await state(id(8)), { booked: 0, held: 0 });
      await fails(
        "amend3",
        book("amend", {
          operation: "amend",
          supplier_reference: result.booking_id,
        }),
        "INVALID_BOOKING",
      );
    },
  );
  await reset();
  await check(
    "closed/full/held capacity and exact option mapping reject without acknowledging",
    async () => {
      await db.query("UPDATE slots SET status='CLOSED' WHERE id=$1", [id(4)]);
      await fails("closed", book("closed"), "NO_AVAILABILITY");
      await db.query("UPDATE slots SET status='OPEN',held=5 WHERE id=$1", [
        id(4),
      ]);
      await fails("held", book("held"), "NO_AVAILABILITY");
      await db.query("UPDATE slots SET held=0 WHERE id=$1", [id(4)]);
      await fails(
        "wrong-option",
        book("wrong-option", { option: "OTHER" }),
        "INVALID_PRODUCT",
      );
      await fails("zero", book("zero", { quantity: 0 }), "VALIDATION_FAILURE");
      await fails(
        "cross",
        book("cross", { product: "P2", option: "O2" }),
        "INVALID_PRODUCT",
        id(2),
      );
    },
  );
  await reset();
  await check(
    "reservation, booked retry, cancellation, terminal reserve retry and atomic expiry",
    async () => {
      const reserve = book("provider-ref", {
        operation: "reserve",
        provider_reference: "provider-ref",
        product: "GYG",
        option: "",
        items: [{ category: "ADULT", count: 1 }],
      });
      const r = await call("reserve", reserve, id(1), "GETYOURGUIDE");
      assert.deepEqual(await state(), { booked: 0, held: 1 });
      const confirmed = await call(
        "book",
        {
          ...reserve,
          operation: "book",
          reference: r.reservation_id,
          reservation_reference: r.reservation_id,
        },
        id(1),
        "GETYOURGUIDE",
      );
      assert.deepEqual(await state(), { booked: 1, held: 0 });
      assert.deepEqual(
        await call("reserve", reserve, id(1), "GETYOURGUIDE"),
        r,
      );
      assert.deepEqual(await state(), { booked: 1, held: 0 });
      await call(
        "cancel-gyg",
        {
          operation: "cancel",
          reference: confirmed.supplier_reference,
          supplier_reference: confirmed.supplier_reference,
          provider_reference: "provider-ref",
          product: "GYG",
        },
        id(1),
        "GETYOURGUIDE",
      );
      assert.deepEqual(await state(), { booked: 0, held: 0 });
      const exp = await call(
        "expire",
        { ...reserve, reference: "expire", provider_reference: "expire" },
        id(1),
        "GETYOURGUIDE",
      );
      await db.query(
        "UPDATE ota_reservations SET expires_at=now()-interval '1 second' WHERE id=$1",
        [exp.reservation_id],
      );
      assert.equal(
        (await db.query("SELECT ota_expire_reservations($1) n", [id(1)]))
          .rows[0].n,
        1,
      );
      assert.equal(
        (await db.query("SELECT ota_expire_reservations($1) n", [id(1)]))
          .rows[0].n,
        0,
      );
      assert.deepEqual(await state(), { booked: 0, held: 0 });
    },
  );
  await reset();
  await check(
    "actual GYG handlers execute A -> B -> A replacement, retries and old-reference cancellations",
    async () => {
      const handler = createGygSupplierHandler(
        createSupplierBackend(transport(db), id(1), "GETYOURGUIDE"),
        { username: "fixture", password: "secret" },
      );
      const send = async (path, data) => {
        const response = await handler(
          new Request("https://fixture.invalid/1/" + path + "/", {
            method: "POST",
            headers: {
              authorization: "Basic " +
                Buffer.from("fixture:secret").toString("base64"),
            },
            body: JSON.stringify({ data }),
          }),
        );
        assert.equal(response.status, 200);
        const payload = await response.json();
        assert(!payload.errorCode, JSON.stringify(payload));
        return payload.data;
      };
      const request = (day) => ({
        gygBookingReference: "GYG-A-B-A",
        productId: "GYG",
        dateTime: "2030-01-" + day + "T10:00:00+02:00",
        bookingItems: [{ category: "ADULT", count: 1 }],
      });
      const reserveA = await send("reserve", request("02"));
      const bookA = await send("book", {
        ...request("02"),
        reservationReference: reserveA.reservationReference,
        travelers: [{ firstName: "Synthetic", lastName: "OTA" }],
        comment: "",
      });
      assert.match(bookA.bookingReference, /^[A-Z0-9]{24}$/);
      assert.deepEqual(await send("reserve", request("02")), reserveA);
      assert.deepEqual(await state(), { booked: 1, held: 0 });
      const reserveB = await send("reserve", request("03"));
      const bookB = await send("book", {
        ...request("03"),
        reservationReference: reserveB.reservationReference,
        travelers: [{ firstName: "Synthetic", lastName: "OTA" }],
        comment: "",
      });
      await send("cancel-booking", {
        bookingReference: bookA.bookingReference,
        gygBookingReference: "GYG-A-B-A",
        productId: "GYG",
      });
      const reserveA2 = await send("reserve", request("02"));
      assert.notEqual(
        reserveA2.reservationReference,
        reserveA.reservationReference,
      );
      const bookA2 = await send("book", {
        ...request("02"),
        reservationReference: reserveA2.reservationReference,
        travelers: [{ firstName: "Synthetic", lastName: "OTA" }],
        comment: "",
        currency: "USD",
        bookingItems: [{ category: "ADULT", count: 1, retailPrice: 1 }],
      });
      assert.notEqual(bookA2.bookingReference, bookA.bookingReference);
      await send("cancel-booking", {
        bookingReference: bookB.bookingReference,
        gygBookingReference: "GYG-A-B-A",
        productId: "GYG",
      });
      await send("cancel-booking", {
        bookingReference: bookA.bookingReference,
        gygBookingReference: "GYG-A-B-A",
        productId: "GYG",
      });
      assert.deepEqual(await state(), { booked: 1, held: 0 });
      assert.deepEqual(await state(id(7)), { booked: 0, held: 0 });
      await db.query(
        "UPDATE ota_product_mappings SET enabled=false WHERE business_id=$1 AND channel='GETYOURGUIDE'",
        [id(1)],
      );
      assert.deepEqual(await send("reserve", request("02")), reserveA2);
      assert.deepEqual(
        await send("book", {
          ...request("02"),
          reservationReference: reserveA2.reservationReference,
          travelers: [{ firstName: "Synthetic", lastName: "OTA" }],
          comment: "",
          bookingItems: [{ category: "ADULT", count: 1, retailPrice: 99999 }],
        }),
        bookA2,
      );
      await db.query(
        "UPDATE ota_product_mappings SET enabled=true WHERE business_id=$1 AND channel='GETYOURGUIDE'",
        [id(1)],
      );
    },
  );
  await reset();
  await check(
    "actual Viator fixture retry ignores Retry flag, exact local calendar closures and DB failure",
    async () => {
      const handler = createViatorSupplierHandler(
        createSupplierBackend(transport(db), id(1), "VIATOR"),
        { apiKey: "fixture-key", supplierId: 1004 },
      );
      const send = async (path, body) => {
        const response = await handler(
          new Request("https://fixture.invalid/" + path, {
            method: "POST",
            headers: { "X-Api-Key": "fixture-key" },
            body: JSON.stringify(body),
          }),
        );
        return { status: response.status, body: await response.json() };
      };
      const data = {
        ApiKey: "fixture-key",
        SupplierId: 1004,
        ResellerId: "1000",
        Timestamp: "2030-01-01T00:00:00Z",
        ExternalReference: "official-v1",
        BookingReference: "V1-ref",
        TravelDate: "2030-01-02",
        SupplierProductCode: "P",
        TourOptions: { SupplierOptionCode: "O", TourDepartureTime: "10:00:00" },
        CurrencyCode: "ZAR",
        Amount: 100,
        Traveller: [{
          TravellerIdentifier: "1",
          GivenName: "Synthetic",
          Surname: "Fixture",
          AgeBand: "Adult",
          LeadTraveller: true,
        }],
      };
      const result = await send("booking", {
        requestType: "BookingRequest",
        data,
      });
      assert.equal(result.body.data.RequestStatus.Status, "SUCCESS");
      const retry = await send("booking", {
        requestType: "BookingRequest",
        data: { ...data, Retry: true },
      });
      assert.equal(
        retry.body.data.SupplierConfirmationNumber,
        result.body.data.SupplierConfirmationNumber,
      );
      assert.deepEqual(await state(), { booked: 1, held: 0 });
      await db.query("UPDATE slots SET status='CLOSED' WHERE id=$1", [id(4)]);
      const calendar = await send("v2/availability/calendar", {
        supplierId: 1004,
        productOptionIds: ["opt-a"],
        startDate: "2030-01-02",
        endDate: "2030-01-03",
      });
      assert.equal(calendar.status, 200);
      assert.deepEqual(
        calendar.body.productOptions[0].dates.map((d) => d.travelDate),
        ["2030-01-03"],
      );
      assert.equal(
        calendar.body.productOptions[0].dates[0].events[0].startTime,
        "10:00",
      );
    },
  );
  await reset();
  await check(
    "canonical direct checkout hold races OTA for last shared seat",
    async () => {
      await db.query("UPDATE slots SET capacity_total=1 WHERE id=$1", [id(4)]);
      await db.query(
        "INSERT INTO bookings(id,business_id,tour_id,slot_id,customer_name,email,qty,unit_price,total_amount,status) VALUES($1,$2,$3,$4,'Direct synthetic','direct@example.invalid',1,100,100,'DRAFT')",
        [id(90), id(1), id(3), id(4)],
      );
      const other = new pg.Client({ ...config, database });
      await other.connect();
      try {
        const results = await Promise.allSettled([
          call("direct-race", book("direct-race")),
          other.query(
            "SELECT create_hold_with_capacity_check($1,$2,1,now()+interval '15 minutes') result",
            [id(90), id(4)],
          ),
        ]);
        const otaSuccess = results[0].status === "fulfilled";
        const directSuccess = results[1].status === "fulfilled" &&
          results[1].value.rows[0].result.success;
        assert.equal(Number(otaSuccess) + Number(directSuccess), 1);
        const counters = await state();
        assert.equal(counters.booked + counters.held, 1);
      } finally {
        await other.end();
      }
    },
  );
  await reset();
  await check(
    "failed amendment and cancellation roll back source/destination seats and event completion",
    async () => {
      const b = await call("rollback-create", book("rollback"));
      await db.query(
        "CREATE TRIGGER ota_fail BEFORE INSERT ON ota_events FOR EACH ROW EXECUTE FUNCTION ota_fail_event()",
      );
      await fails(
        "rollback-amend",
        book("rollback", {
          operation: "amend",
          supplier_reference: b.booking_id,
          date: "2030-01-03",
          quantity: 2,
        }),
        "injected",
      );
      assert.deepEqual(await state(), { booked: 1, held: 0 });
      assert.deepEqual(await state(id(7)), { booked: 0, held: 0 });
      await fails("rollback-cancel", {
        operation: "cancel",
        reference: "rollback",
        supplier_reference: b.booking_id,
      }, "injected");
      assert.deepEqual(await state(), { booked: 1, held: 0 });
      assert.equal(
        (await db.query("SELECT status FROM bookings WHERE id=$1", [
          b.booking_id,
        ])).rows[0].status,
        "PAID",
      );
      await db.query("DROP TRIGGER ota_fail ON ota_events");
      await call(
        "rollback-amend",
        book("rollback", {
          operation: "amend",
          supplier_reference: b.booking_id,
          date: "2030-01-03",
          quantity: 2,
        }),
      );
      assert.deepEqual(await state(id(7)), { booked: 2, held: 0 });
    },
  );
  await reset();
  await check(
    "actual Viator v2 reserve -> v1 book consumes held seats, retries and rejects mismatched hold",
    async () => {
      const handler = createViatorSupplierHandler(
        createSupplierBackend(transport(db), id(1), "VIATOR"),
        { apiKey: "fixture-key", supplierId: 1004 },
      );
      const send = async (path, body) => {
        const response = await handler(
          new Request("https://fixture.invalid/" + path, {
            method: "POST",
            headers: { "X-Api-Key": "fixture-key" },
            body: JSON.stringify(body),
          }),
        );
        return response.json();
      };
      const r = await send("v2/reserve", {
        supplierId: 1004,
        productOptionId: "opt-a",
        travelDate: "2030-01-02",
        startTime: "10:00",
        tickets: [{ type: "ADULT", quantity: 1 }],
        totalTravelers: 1,
      });
      assert.equal(r.status, "RESERVED");
      assert.deepEqual(await state(), { booked: 0, held: 1 });
      const data = {
        ApiKey: "fixture-key",
        SupplierId: 1004,
        ResellerId: "1000",
        Timestamp: "2030-01-01T00:00:00Z",
        ExternalReference: "v2-v1-book",
        BookingReference: "V2-ref",
        TravelDate: "2030-01-02",
        SupplierProductCode: "P",
        TourOptions: { SupplierOptionCode: "O", TourDepartureTime: "10:00:00" },
        CurrencyCode: "ZAR",
        Amount: 80,
        AvailabilityHoldReference: r.reference,
        Traveller: [{
          TravellerIdentifier: "1",
          GivenName: "Synthetic",
          Surname: "Fixture",
          AgeBand: "Adult",
          LeadTraveller: true,
        }],
      };
      const confirmed = await send("booking", {
        requestType: "BookingRequest",
        data,
      });
      assert.equal(confirmed.data.RequestStatus.Status, "SUCCESS");
      assert.deepEqual(await state(), { booked: 1, held: 0 });
      await db.query(
        "UPDATE ota_product_mappings SET enabled=false WHERE business_id=$1 AND channel='VIATOR'",
        [id(1)],
      );
      assert.equal(
        (await send("booking", {
          requestType: "BookingRequest",
          data: { ...data, Retry: true },
        })).data.SupplierConfirmationNumber,
        confirmed.data.SupplierConfirmationNumber,
      );
      await db.query(
        "UPDATE ota_product_mappings SET enabled=true WHERE business_id=$1 AND channel='VIATOR'",
        [id(1)],
      );
      const mismatched = await send("booking", {
        requestType: "BookingRequest",
        data: {
          ...data,
          ExternalReference: "wrong-held",
          BookingReference: "wrong-held",
          TravelDate: "2030-01-03",
        },
      });
      assert.equal(mismatched.data.RequestStatus.Status, "ERROR");
      assert.deepEqual(await state(), { booked: 1, held: 0 });
    },
  );
  await reset();
  await check(
    "actual availability sync emits change closures and rolls back successful status on write failure",
    async () => {
      await db.query(
        "INSERT INTO ota_integrations(business_id,channel,config_json) VALUES($1,'GETYOURGUIDE','{}')",
        [id(1)],
      );
      await db.query(
        "UPDATE slots SET start_time=now()+interval '1 day' WHERE id=$1",
        [id(4)],
      );
      const messages = [];
      const notify = async (payload) => {
        messages.push(payload);
      };
      await syncSupplierAvailability(
        transport(db),
        id(1),
        "GETYOURGUIDE",
        notify,
      );
      assert(messages.length > 0);
      assert(
        messages[0].data.availabilities.some((row) => row.vacancies === 5),
      );
      messages.length = 0;
      await db.query("UPDATE slots SET status='CLOSED' WHERE id=$1", [id(4)]);
      await syncSupplierAvailability(
        transport(db),
        id(1),
        "GETYOURGUIDE",
        notify,
      );
      assert(
        messages[0].data.availabilities.some((row) => row.vacancies === 0),
      );
      messages.length = 0;
      await db.query("UPDATE slots SET status='OPEN' WHERE id=$1", [id(4)]);
      await db.query(
        "CREATE TRIGGER ota_snapshot_fail BEFORE UPDATE ON ota_availability_snapshots FOR EACH ROW EXECUTE FUNCTION ota_fail_event()",
      );
      await assert.rejects(
        syncSupplierAvailability(transport(db), id(1), "GETYOURGUIDE", notify),
        /snapshot write failed/,
      );
      assert(messages.length > 0);
      await db.query(
        "DROP TRIGGER ota_snapshot_fail ON ota_availability_snapshots",
      );
      await db.query("UPDATE ota_runtime_boundary SET environment='BLOCKED'");
      await assert.rejects(
        syncSupplierAvailability(transport(db), id(1), "GETYOURGUIDE", notify),
        /OTA_NOT_READY/,
      );
      await db.query("UPDATE ota_runtime_boundary SET environment='SANDBOX'");
    },
  );
  console.log(`Passed ${passed} PostgreSQL OTA regression groups`);
} finally {
  await db.end().catch(() => {});
  if (created) await admin.query("DROP DATABASE " + database + " WITH (FORCE)");
  await admin.end();
}
