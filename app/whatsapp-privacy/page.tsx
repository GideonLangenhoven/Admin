"use client";

import { BrandMark } from "../../components/BrandLogo";

export default function WhatsappPrivacyPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12 bg-[var(--ck-bg-app)]">
      <div 
        className="ui-card anim-fade-up relative w-full max-w-2xl overflow-hidden p-8 sm:p-10 md:p-12" 
        style={{ 
          boxShadow: "var(--ck-shadow-lg)",
          backgroundColor: "var(--ck-card-bg)",
          borderRadius: "24px",
          border: "1px solid var(--ck-border-subtle)"
        }}
      >
        <div className="absolute inset-x-0 top-0 h-1.5 bg-bt-gradient" aria-hidden="true" />
        
        <div className="mb-8 text-center">
          <BrandMark size={48} className="mx-auto mb-4" />
          <h1 className="font-display text-[28px] font-semibold leading-tight" style={{ color: "var(--ck-text-strong)" }}>
            Privacy Policy
          </h1>
          <p className="text-sm mt-2" style={{ color: "var(--ck-text-muted)" }}>
            For BookingTours WhatsApp Booking Bot
          </p>
          <p className="text-xs mt-1 italic" style={{ color: "var(--ck-text-muted)" }}>
            Last Updated: July 14, 2026
          </p>
        </div>

        <div className="space-y-6 text-sm leading-relaxed" style={{ color: "var(--ck-text)" }}>
          <section>
            <h2 className="text-base font-semibold mb-2" style={{ color: "var(--ck-text-strong)" }}>
              1. Overview
            </h2>
            <p>
              This Privacy Policy explains how BookingTours ("we", "us", "our") collects, uses, processes, 
              and protects personal information collected via our WhatsApp booking bot assistant. 
              The WhatsApp bot is a white-label integration provided by BookingTours to authorized tour operators 
              to facilitate direct booking inquiries, scheduling, and notifications.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold mb-2" style={{ color: "var(--ck-text-strong)" }}>
              2. Information We Collect
            </h2>
            <p className="mb-2">
              When you interact with the WhatsApp Booking Bot, we collect the minimum personal information 
              necessary to service your request:
            </p>
            <ul className="list-disc pl-5 space-y-1.5">
              <li><strong>WhatsApp Phone Number:</strong> To route messages and verify your conversation thread.</li>
              <li><strong>Message History:</strong> The text and contents of your messages to analyze your intent and generate automated responses.</li>
              <li><strong>Booking Details:</strong> Name, email address, party size, selected tour, and date/time that you explicitly provide to make a booking.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold mb-2" style={{ color: "var(--ck-text-strong)" }}>
              3. How We Use Your Information
            </h2>
            <p className="mb-2">
              We process your personal information for the following legitimate business purposes:
            </p>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>To answer questions about tour details, pricing, availability, and policies.</li>
              <li>To hold, create, confirm, modify, or cancel tour bookings on your behalf.</li>
              <li>To issue secure payment links, receipts, and invoices.</li>
              <li>To send critical transactional notifications, including day-before reminders and weather-related alerts.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold mb-2" style={{ color: "var(--ck-text-strong)" }}>
              4. Data Sharing and Third Parties
            </h2>
            <p className="mb-2">
              We do not sell, rent, or trade your personal information. We share it only with trusted service providers 
              necessary to complete the booking workflow:
            </p>
            <ul className="list-disc pl-5 space-y-1.5">
              <li><strong>The Selected Tour Operator:</strong> To fulfill the booking and provide the tour activity.</li>
              <li><strong>Meta Platforms, Inc.:</strong> As the underlying provider of the WhatsApp Business API.</li>
              <li><strong>Database Hosting & AI Processors:</strong> Under strict confidentiality and data-processing terms to host database records and process LLM-based message responses.</li>
              <li><strong>Payment Gateways:</strong> To securely process transactions without storing credit card details on our servers.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold mb-2" style={{ color: "var(--ck-text-strong)" }}>
              5. Data Security and Encryption
            </h2>
            <p>
              We prioritize data security. All communications between the Meta API and our servers are encrypted in transit 
              using TLS 1.2+. At-rest credentials, database records, and transaction logs are stored securely using 
              AES-256 encryption. Access controls are limited strictly to authorized operator personnel.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold mb-2" style={{ color: "var(--ck-text-strong)" }}>
              6. Data Retention and Your Rights
            </h2>
            <p>
              We retain chat histories only as long as necessary to maintain contextual continuity and facilitate 
              customer service. Financial transaction records are retained for 5 years to comply with statutory tax laws. 
              Under applicable laws (including POPIA and GDPR), you have the right to request access to, correction of, 
              or deletion of your personal data. 
              To submit a request, contact us at <strong>support@bookingtours.co.za</strong>.
            </p>
          </section>

          <section className="pt-4 border-t border-[var(--ck-border-subtle)] text-center text-xs" style={{ color: "var(--ck-text-muted)" }}>
            <p>BookingTours © {new Date().getFullYear()}. All rights reserved.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
