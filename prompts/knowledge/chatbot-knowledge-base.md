# Comparit Platform - Feature Knowledge Base

## 1. Platform Overview

**Comparit** is a professional insurance comparison and consulting platform (German market) for insurance brokers ("Vermittler"). It allows brokers to compare tariffs from multiple insurers across 11 insurance lines ("Sparten"), manage clients, create applications, generate documents, and handle the full insurance advisory workflow.

The platform is a web application built with Angular 19, using an Nx monorepo with micro-frontends (Native Federation). It communicates with a backend via REST APIs and real-time SignalR WebSocket connections for tariff calculations. Authentication is handled through Keycloak.

---

## 2. Supported Insurance Lines (Sparten)

Comparit supports 11 insurance lines, organized into groups:

### Existenzsicherung (Income Protection)
| Insurance Line | Abbreviation | German Name | Description |
|---|---|---|---|
| Disability Insurance | BU | Berufsunfähigkeitsversicherung | Protects against loss of income due to occupational disability |
| Term Life Insurance | RLV | Risikolebensversicherung | Pays a death benefit to beneficiaries during the policy term |
| Basic Ability Insurance | GF | Grundfähigkeitsversicherung | Pays benefits when basic abilities (seeing, walking, etc.) are lost |

### Altersvorsorge (Retirement/Pension)
| Insurance Line | Abbreviation | German Name | Description |
|---|---|---|---|
| Basis Rente (Rürup) | BR | Basisrente | Tax-advantaged retirement pension (Rürup pension) |
| Private Rente | PR | Private Rentenversicherung | Private pension insurance for retirement income |

### Krankenversicherung (Health Insurance)
| Insurance Line | Abbreviation | German Name | Description |
|---|---|---|---|
| Private Health (Full) | KVV | Krankenversicherung Voll | Full private health insurance (Vollversicherung) |
| Supplementary Health | KVZ | Krankenversicherung Zusatz | Supplementary health insurance on top of statutory insurance |

### Sachversicherung (Property Insurance)
| Insurance Line | Abbreviation | German Name | Description |
|---|---|---|---|
| Homeowners Insurance | WG | Wohngebäudeversicherung | Building/property insurance for residential buildings |
| Household Contents | HR | Hausratversicherung | Insurance for household contents |

### Haftpflicht (Liability)
| Insurance Line | Abbreviation | German Name | Description |
|---|---|---|---|
| Personal Liability | PHV | Privathaftpflichtversicherung | Personal liability insurance |

### Mobilitat (Mobility)
| Insurance Line | Abbreviation | German Name | Description |
|---|---|---|---|
| Motor Vehicle | KFZ | Kfz-Versicherung | Car/motor vehicle insurance |

---

## 3. Core User Workflow

The typical workflow in Comparit follows these steps:

### Step 1: Login & Dashboard
- Brokers log in via Keycloak authentication
- The **Dashboard** is the landing page (`/dashboard`)
- **Greeting section** with personalized welcome and unread notification count
- **Kunden (Clients) Box**: Shows last 3 created clients with search, context menu for "Neue Berechnung" (New Calculation), "IDD Beratung" (IDD Consulting), "Kundendetails" (Client Details)
- **Antrags-Vorgänge (Application Processes) Box**: Lists saved application processes with infinite scroll pagination (20 items/page), last modified date, delete option
- **Rechner (Calculator) Box**: Product selector to start new calculations for any available insurance line
- Notifications system alerts about important events

### Step 2: Client Management
- Navigate to **Clients** (`/clients`)
- **View client list** with search and filtering
- **Add new clients** (`/clients/add`) with personal data:
  - Salutation (Herr/Frau/Divers)
  - First name, last name
  - Date of birth, gender
  - Address (street, house number, postal code, city)
  - Contact (phone, mobile, email, website)
  - Marital status, smoking habits
  - Professional information (employment status, occupation, education)
  - Customer type: Private customer (Privatkunde) or Business customer (Geschäftskunde)
  - Legal form (for business customers)
- **View client details** (`/clients/:clientId`) with full profile and history

### Step 3: Start a Comparison (Vergleich)
- Navigate to **Vergleich** (`/vergleich`) and choose an insurance line
- Each insurance line starts with a **Grunddaten** (basic data) form:
  - Date of birth
  - Gender (Male/Female/Diverse)
  - Contract start date
  - Payment frequency (Monthly, Quarterly, Semi-annually, Annually)
  - Insurance-line-specific fields (see Section 4 below)
- Optionally assign a client to the comparison
- Optionally add insured persons ("Versicherte Personen") — especially relevant for KVV/KVZ

### Step 4: View Calculation Results
- After submitting basic data, the system performs **real-time tariff calculations** via SignalR WebSocket
- Results stream in progressively — the UI shows a calculation summary with:
  - Number of successful tariffs vs. total expected
  - Number of responding insurers vs. total expected
- Each result card shows:
  - Insurer name and logo
  - Tariff name and description
  - Premium/price (Beitrag)
  - Rating (if available)
  - Fulfillment grade ("Erfüllungsgrad") showing how well the tariff meets mandatory and desired requirements
  - Tips/recommendations
  - Warning notes
- Results can be **sorted** by various criteria:
  - Premium (Beitrag), Insurer name (alphabetical)
  - For pension: Guaranteed pension, pension factor, target pension, effective costs
  - For property: Deductible (Selbstbehalt), insured sum
  - For health: Co-payment, employee share, effective premium
  - Fulfillment grade of desired benefits

### Step 5: Customize Protection (Schutz Optimieren)
- **Schutz Optimieren** allows fine-tuning which coverage attributes are important
- Attributes are organized in "Kacheln" (tiles/cards) and attribute groups
- Each attribute can be set as:
  - Mandatory requirement (Pflichtleistung)
  - Desired requirement (Wunschleistung)
  - Not relevant
- The system recalculates and re-ranks tariffs based on selected requirements
- Fulfillment grade shows how many mandatory and desired requirements each tariff meets

### Step 6: Compare Tariffs
- Select up to **6 tariffs** to compare side-by-side (`/matrix`)
- Detailed comparison view shows all attributes grouped by category
- **Display options:**
  - Leistungstexte anzeigen (Show benefit texts)
  - Farbige Hinterlegung (Colored highlighting of differences)
  - Nur Unterschiede (Show differences only)
  - Rating display (overall and per category)
- Compare bar shows selected tariffs for quick comparison
- **Pin tariffs** ("Anpinnen") to keep them visible while scrolling
- **Reference tariff** feature: set a tariff as reference and compare others against it

### Step 7: Filter & Refine Results
- **Filter bar** with multiple options:
  - Sort by different criteria
  - Show/hide failed results (tariffs that couldn't be calculated)
  - Show/hide excluded results
  - Show/hide "Fremdtarife" (third-party/external tariffs)
  - Tariff building blocks ("Bausteine") — add or remove optional tariff components
- **Product provider dialog** to see which insurers participated in the calculation

### Step 8: Warenkorb (Shopping Cart) / Application
- Select tariffs and proceed to **Warenkorb** (shopping cart / application process)
- The application process ("Antrag") includes:
  - **Tariff selection** — choose specific tariffs
  - **Application questions** ("Antragsfragen") — insurer-specific dynamic form with field types: free text, text area, email, phone, tax ID, number, date, address, dropdown, checkbox, bank details (Bankverbindung), document upload, profession list (with search). Questions are organized in collapsible groups with contextual help.
  - **Document management** — manage required documents:
    - Consultation documents (Beratungsdokumente)
    - Proposal documents (Vorschlagsdokumente)
    - Insurer offers, contracts, SEPA forms
    - Product information, conditions
    - Privacy policies, duty of disclosure
    - Coverage notes (Deckungsnoten), eVB numbers
  - **Document folder** ("Dokumentenmappe") — organize documents
  - **File upload** — upload additional documents
  - **Digital signing** via InSign integration
  - **Send application** — via email or direct transmission
  - **Send to MVP/Simplr** — integration with external systems

### Step 9: Vorgang (Insurance Process) Management
- Each application creates a **Vorgang** (insurance process/case)
- Vorgang lifecycle statuses:
  - **New** — just created
  - **Filled** — data entered
  - **Signed** — documents signed
  - **ContractSent** — contract sent to insurer
  - **ContractSetOrder** — order set with insurer
  - **ContractEmailSent** — confirmation email sent
- Track and manage all Vorgange from the dashboard

### Step 10: PDF Generation & Printing
- **Generate PDF** of calculation results
- PDF includes selected tariffs, comparison data, and consultation documentation
- Print functionality with configurable options
- PDF accessible via dedicated route (`/pdf/calculation-results`)

---

## 4. Insurance-Line-Specific Features

### BU (Disability Insurance)

**Steps**: Grunddaten → Beruf & Risiken → Schutz Optimieren → Rechner (Results) → Matrix (Comparison) → Antrag

**Grunddaten (Step 1) Input Fields:**
- Geburtstag (Date of birth)
- Geschlecht (Gender)
- Vertragsbeginn (Contract start date) — must be first of the month
- Vertragsablaufalter (Contract end age, 15-67)
- Vertragsende (Contract end date)
- Monatsgenau (Monthly precision) — checkbox for birthday-aligned end
- Verlängerte Leistungsdauer (Extended benefit duration) — optional with end age/date
- Tarifart: Normal (standard) or Starter (reduced initial contributions for young people)
- Vorgabewunsch (Objective preference): Garantierte Rente (guaranteed pension) or Beitrag (premium)
- Garantierte Rente or Beitrag Summe (amount depending on objective)
- Beitragszahlweise (Payment frequency: monthly/quarterly/semi-annually/annually)
- Inflationsschutz/Dynamik (Inflation protection)
- Überschussverwendung (Profit utilization)
- Garantierte Rentensteigerung (Guaranteed pension increase)
- Optional: Number of children, marital status, owner-occupied property

**Beruf & Risiken (Step 2):**
- Occupation search with autocomplete
- Qualification level, employment status
- Risk factors (smoking, body measurements, motorcycling)

**Results display columns:**
- Vertragslaufzeit (Contract duration), Berufsbezeichnung (Profession), Gewinnverwendung (Profit utilization), Leistungszeitraum (Benefit period), StarterTarif, BMI consideration, Garantierte Rente, Gesamte Rente, Beitragsdynamik, Leistungsdynamik, Sonderkonditionen
- **Sort options**: Versicherer (alphabetical), Beitrag, Maximalbeitrag

---

### RLV (Term Life Insurance)

**Steps**: Grunddaten → Beruf & Risiken → Schutz Optimieren → Rechner → Matrix → Antrag

**Grunddaten (Step 1) Input Fields:**
- Geburtstag, Geschlecht, Vertragsbeginn
- Vertragsdauer in Jahren (Contract duration in years)
- Versicherungssumme im Todesfall (Death benefit amount)
- Risikolebensversicherung Art (Type):
  - Konstant (Constant benefit)
  - Linear fallend (Linearly decreasing)
  - Annuitätisch fallend (Annuity-style decreasing)
- If loan-secured: Zinssatz Nominal, Tilgungssatz, Tilgungsfreie Jahre
- Beitragszahlweise (Payment frequency)
- Überschussverwendung (Profit utilization)
- Beitragsbefreiung bei Berufsunfähigkeit (Premium waiver on disability) — checkbox
- Darlehensabsicherung (Loan coverage) with loan amount and existing coverage
- Optional: Number of children, property ownership

**Results display columns:**
- Vertragslaufzeit, Berufsbezeichnung, Gewinnverwendung, Versicherungssumme, BUZ Beitragsbefreiung, BMI consideration, Summenverlauf (Benefit curve type), Erhöhte Leistung bei Unfalltod (Enhanced accident death benefit), Beitragsdynamik, Extraleistung Schwere Krankheiten
- **Sort options**: Versicherer, Beitrag, Maximalbeitrag

---

### GF (Basic Ability Insurance)

**Steps**: Grunddaten → Beruf & Risiken → Schutz Optimieren → Rechner → Matrix → Antrag

**Grunddaten (Step 1) Input Fields:**
- Geburtstag, Geschlecht, Vertragsbeginn
- Vertragsablauf zum Alter (Contract end age)
- Vertragsende (Contract end date)
- Monatsgenau (Monthly precision)
- Verlängerte Leistungsdauer (Extended benefit duration) — optional
- Vorgabewunsch: Beitrag or Garantierte Rente
- Amount field (based on objective)
- Beitragszahlweise (Payment frequency)
- Dynamik/Inflationsschutz (Inflation protection)
- Überschussverwendung (Surplus use)
- Garantierte Rentensteigerung
- Optional: Number of children, marital status, owner-occupied property

**Results display:**
- Sort by Beitrag, MaximalBeitrag, GesamteRente (or GarantierteRente depending on objective)
- Attribute-based protection selection in tiles/boxes

---

### Basis Rente (Rürup Pension)

**Steps**: Grunddaten → Garantien & Rendite → Beruf & Risiken → Schutz Optimieren → Rechner → Matrix → Antrag

**Grunddaten (Step 1) Input Fields:**
- Tarifart: Aufgeschobene Rente (Deferred) or Sofortbeginnend (Immediate)
- Geburtstag, Geschlecht, Vertragsbeginn
- Rentenbeginn zum Alter (Pension start age) — for deferred
- Rentenbeginn (Pension start date)
- Monatsgenauer Rentenbeginn (Month-exact start)
- Vorgabewunsch: Beitrag, Einmalbeitrag (single payment), Rente, Zusatzrente
- VorgabewunschPrice (Target amount)
- Beitragszahlweise (Monthly/quarterly/annually/single)
- Inflationsschutz/Dynamik — if not single payment
- Garantierte Rentensteigerung
- Zusätzliche Einmalzahlung zu Beginn (Additional lump sum at start) — optional
- Abgekürzte Beitragszahlungsdauer (Shortened contribution period) — optional
- **Death benefit protection:** Coverage in accumulation phase (Rückkauf, Todesfallleistung, Zahlung Rente, Kapital), pension guarantee period
- **Disability coverage:** Premium waiver on disability, disability pension amount

**Garantien & Rendite (Step 2):**
- Fund selection for unit-linked policies (Fondslisten)
- Guaranteed return vs. projected return visualization

**Results display:**
- Sort options: GarantierteRente, ZielrenteMittel, ZielkapitalMittel, GarantierterRentenfaktor, Effektivkosten
- For immediate pensions: capital-based columns removed

---

### Private Rente (Private Pension Insurance)

**Steps**: Same as Basis Rente + IDD assessment routes

**Grunddaten (Step 1) — extends Basis Rente with:**
- Kindertarif (Junior/child tariff) — child must be ≤15 years old, requires separate insured person
- Multiple insured persons support (abweichende versicherte Person)
- Disability coverage only shown for Aufgeschobene Rente + non-single payment

**IDD (Insurance Distribution Directive):**
- Multi-step ESG/sustainability preferences questionnaire
- Linked from client details page
- Requires BR + PR permissions

---

### KVV (Full Private Health Insurance)

**Steps**: Grunddaten → Leistungsumfang → Ergänzungen → Schutz Optimieren → Rechner → Matrix → Antrag

**Grunddaten (Step 1) Input Fields:**
- Geburtsdatum, Geschlecht, Vertragsbeginn (first of month only)
- Beschäftigungsverhältnis (Employment type: employee, self-employed, civil servant, student, etc.)
- Beruf/Ausgeübte Tätigkeit (Profession)
- Selbständig/Freiberuflich seit (Self-employed since) — conditional
- Spezielle Arzttarife mitberechnen (Include special doctor tariffs)

**Leistungsumfang (Step 2) Input Fields:**
- **Selbstbehalt (Deductible):** Min & Max range (0-5000 EUR in 10 EUR steps)
- **Ambulante Leistungen (Outpatient):** Primary physician requirement, visual aids, outpatient fee schedule, naturopathic procedures
- **Stationäre Leistungen (Inpatient):** Hospital accommodation, private doctor choice, inpatient fee schedule
- **Dentale Leistungen (Dental):** Tooth treatment, dental prosthetics, orthodontics, dental fee schedule
- Pflegepflicht (Nursing care requirement)
- Beihilfeergänzung (Subsidy supplement)

**Ergänzungen (Step 3) Input Fields:**
- **Krankentagegeld (Daily sickness benefit):** Daily rate (5-1000 EUR), waiting period (Karenzzeit: day 1/4/8/15/22/29/36/43), up to 3 separate arrangements
- **Krankenhaustagegeld (Hospital daily allowance):** 10-500 EUR in 5 EUR steps
- **Kurtagegeld (Spa/clinic daily allowance):** 10-500 EUR
- **Pflegezusatz (Nursing care supplement):** 5 care levels, ambulant & stationary
- **Beitragsentlastung (Premium relief):** With own contribution (Eigenanteil)

**Multiple insured persons:** Can add and manage family members, copy settings between them

**Results display:**
- Brutto/Netto Beitrag, Effektiv Beitrag, Arbeitnehmeranteil, AG-Zuschuss
- Selbstbeteiligung (annual/monthly), Krankheitskosten
- Steuererstattung (tax refund — manually editable), Grenzsteuersatz, Gesamtaufwand
- Zuschläge (surcharges), coverage percentages, premium refund details
- **Sort options**: Gesamtbeitrag, Arbeitnehmeranteil, Effektivbeitrag, Selbstbeteiligung, KrankheitskostenBeitrag

**Special features:**
- Contributions modal for manual tariff price adjustment
- Tax savings mini-tool calculator
- Family overview with per-person results

---

### KVZ (Supplementary Health Insurance)

**Steps**: Grunddaten → Leistungsumfang → Schutz Optimieren → Rechner → Matrix → Antrag

- Same base data structure as KVV (Steps 1-2)
- Fewer coverage options (supplementary nature)
- Multiple insured persons support

---

### WG (Homeowners/Building Insurance)

**Steps**: Grunddaten → Ausführung → Deckungsumfang → Schutz Optimieren → Rechner → Matrix → Antrag

**Grunddaten (Step 1) Input Fields:**
- Geburtstag, Geschlecht, Beschäftigungsverhältnis
- Building address (PLZ, Ort, Straße) with validation
- Gebäudetyp (Building type enum)
- Bauweise (Construction type), Bauartklasse (Building classification)
- Dacheindeckung (Roof covering), Fertighaus group
- Permanently inhabited checkbox
- Construction year / modernization info
- **Nebengebäude (Secondary buildings):** Can add multiple with type, value, features

**Ausführung (Step 2) Input Fields:**
- Wertermittlung method (Property value determination)
- Custom property value
- **Modernization flags:** Core-renovated, individual areas (pipes, electrics, heating, roof)
- **Renewable energy:** Photovoltaik, Solarthermie, Wärmepumpe

**Deckungsumfang (Step 3):**
- Coverage amount based on valuation
- Additional coverage options

**Special features:**
- Address validation with suggestions dialog
- ZÜRS zone lookup for flood/natural hazard assessment

---

### HR (Household Contents Insurance)

**Steps**: Grunddaten → Deckungsumfang → Schutz Optimieren → Rechner → Matrix → Antrag

**Grunddaten (Step 1) Input Fields:**
- Geburtstag, Geschlecht, Insurance date, Employment type
- Risk address (PLZ, Ort, Straße, Hausnummer) — can copy from policyholder
- Building classification, construction type, roof covering
- Damage history checkbox

**Deckungsumfang (Step 2) Input Fields:**
- Versicherungssumme: Standard recommendation (based on address) or custom amount
- Specific item additions via "Schaden hinzufügen" (damage items dialog) with category and value

---

### PHV (Personal Liability Insurance)

**Steps**: Grunddaten → Deckungsumfang → Schutz Optimieren → Rechner → Matrix → Antrag

**Grunddaten (Step 1) Input Fields:**
- Geburtstag, Geschlecht, Beschäftigungsverhältnis
- Coverage type (Versichert werden):
  - Single
  - Single mit Kindern (+ number of children 0-20)
  - Familie (family)
  - Partner (+ partner employment type)
- Postal code (for risk location)

**Deckungsumfang (Step 2):**
- Coverage amounts with standard presets or custom (individuell) configuration
- Additional damage items via SchadenModal

---

### KFZ (Motor Vehicle Insurance)

**Steps**: Einstieg → Fahrzeug → Zur Person → SF-Klassen → Schutz Optimieren → Rechner → Matrix → Antrag

**Einstieg (Step 1) Input Fields:**
- Vertragsbeginn (Contract start) with rules for new vs. existing vehicles
- Contract type/reason (new purchase, switch, etc.)
- Vehicle type (car, motorcycle, etc.)
- Contracting option

**Fahrzeug (Step 2) Input Fields:**
- Vehicle search from catalog or manual entry
- HSN (maker code) + TSN (type code)
- Make, model, variant, year, first registration
- Mileage, horsepower, engine displacement, fuel type, transmission, color, VIN
- License plate (Kennzeichen) with regional part — visual car plate component
- Annual mileage, parking location, usage type

**Zur Person (Step 3) Input Fields:**
- Policyholder & driver data: birth date, license acquisition date, employment, occupation
- Multiple drivers can be added
- Main driver specification
- Previous insurance/no-claim discount info

**SF-Klassen (Step 4):**
- SF class for liability, partial, comprehensive coverage
- Adjustment based on accident history

**Special features:**
- AI-powered price estimation component
- EVB number generation (electronic insurance confirmation)
- Deckungsnote (Coverage note) generation
- Discounts system
- Custom application flow (different from standard Warenkorb)

---

## 5. Task System (Multitask)

- **Tasks** allow saving and resuming work in progress
- Create tasks for any insurance comparison
- Tasks save the complete form state (all input data, selected persons, calculation results)
- Tasks can be assigned to clients
- Task list with filtering:
  - By insurance line
  - By scope: "All", "Mine only", "Others only"
  - Search by task name or client
- **Multitask** feature: Work on multiple insurance lines for the same client
- Continue tasks later from the dashboard or task list
- Task loading page (`/task/:id`) restores the full comparison state

---

## 6. Notifications

- Real-time notification system
- Notifications appear in the header/navigation
- Mark notifications as read
- Types include system notifications and process updates

---

## 7. Onboarding Features

The platform has an onboarding system that introduces users to key features:
- **Multitask** — Working with multiple insurance lines
- **Tarifbausteine** — Tariff building blocks/components
- **Anpinnen** — Pinning tariffs for comparison
- **Schutz Optimieren** — Customizing protection requirements
- **Vollintegriert** — Fully integrated application process
- **Deckungsnote** — Coverage note generation

---

## 8. Tenant/White-Label Configuration (Allianz Mode)

The platform supports multi-tenant configuration, notably an "Allianz Mode":
- **Default mode**: Full functionality — personal data, documents, all customer types, application actions
- **Allianz mode**: Restricted — no personal data, no documents, no email display, numeric-only inputs, private customers only, no application actions, no Vorgange in dashboard, hides inactive Sparten

---

## 9. User Roles & Permissions

### Users
- Authenticated via Keycloak
- Each user is linked to a **Vermittler** (broker) and **Vermittlergruppe** (broker group)
- User profile includes CRM display name and pool name

### Broker (Vermittler) Data
- Full broker identification: name, company, IHK number
- Contact information and address
- Broker type and classification
- Vermittlernummern (broker numbers) per insurer for commission tracking

### Permissions
- **Sparte permissions**: Which insurance lines a user can access (controlled per session)
- **IDD access**: Requires both Basis Rente (BR) and Private Rente (PR) permissions
- Route guards (AuthGuard, SessionGuard, SparteGuard) protect all pages

---

## 10. CPIT Plus / Erfüllungsgrad (Fulfillment Grade)

- Premium feature ("CPIT Plus") that enables advanced tariff quality assessment
- **Erfüllungsgrad** shows how well a tariff meets the broker's specified requirements:
  - Mandatory requirements fulfilled vs. total
  - Desired requirements fulfilled vs. total
  - List of unfulfilled requirements with reasons
- **Reference Tariff**: Set a tariff as the benchmark to compare all others against
- Available when the subscription includes CPIT Plus

---

## 11. Document Management

### Document Types
- **CpitBeratung** — Comparit consultation document
- **CpitVorschlag** — Comparit proposal document
- **InsurerOffer** — Insurer's offer document
- **InsurerContract** — Insurance contract
- **InsurerSepa** — SEPA direct debit mandate
- **InsurerProductInformation** — Product information sheet
- **InsurerConditions** — Insurance conditions
- **InsurerDutyOfDisclosure** — Duty of disclosure form
- **InsurerPrivacyPolicy** — Privacy policy
- **CpitDeckungsnote** — Coverage note (especially for KFZ)
- **CpitEvb** — Electronic insurance confirmation (eVB for KFZ)
- **Uploaded** — User-uploaded documents
- **InSignUpload** — Documents from digital signing

### Digital Signing (InSign)
- Integration with InSign for digital document signing
- Retrieve signing session URLs
- Track signing status per Vorgang

---

## 12. Copilot Widget (Bug Reporting & Support)

The platform includes an embedded **Copilot Bug Widget** for user support:

### Chat Mode
- AI-powered chat assistant for reporting issues
- Automatically captures context: current page/sparte, user email, app version
- Interactive conversation to gather bug details
- Automatic submission of structured bug reports when conversation is complete

### Form Mode
- Manual bug report form with:
  - Title (min 5 characters)
  - Description (min 10 characters)
  - Severity: Blocker, High, Medium, Low
  - Insurance line selection
- Automatically captures browser context (URL, viewport, user agent, timestamps)

---

## 13. Address Validation

- Used primarily for property insurance (WG, HR) and client management
- **Postal code validation** — validates German postal codes
- **City lookup** — suggests cities for a given postal code
- **Street lookup** — suggests streets for a given city
- **Full address validation** — validates complete addresses
- **ZÜRS zone lookup** — determines natural hazard zones for property insurance

---

## 14. Pool Session Management

- Supports "pool sessions" where external users access the platform through shared sessions
- Pool sessions have limited permissions and timeouts
- Used for external integrations and white-label scenarios

---

## 15. External Integrations

- **Keycloak**: Authentication and user management
- **SignalR**: Real-time tariff calculation communication
- **InSign**: Digital document signing
- **MVP/Simplr**: External application submission systems
- **Webhooks**: Configurable webhook endpoints for events
- **Matomo**: Analytics tracking (via ngx-matomo-client)
- **Grafana Faro**: Frontend monitoring and tracing

---

## 16. Technical Architecture

### Application Structure
- **Host App** (`comparit`): Main shell application with dashboard, clients, routing
- **Remote Apps** (micro-frontends): Each insurance line is a separate federated module
  - `bu`, `risikoleben`, `gf` — Income protection apps
  - `basis-rente`, `private-rente` — Pension apps
  - `kvv`, `kvz` — Health insurance apps
  - `kfz` — Motor vehicle app
  - `wohngebaeude`, `hausrat`, `phv` — Property/liability apps

### Shared Libraries
- `@comparit/comparer` — Core comparison engine, services, components, interfaces
- `@comparit/core` (libs/src) — Shared utilities, validators, form helpers
- `@comparit/ui` — Shared UI component library (40+ reusable components)
- `@comparit/lv` — Shared life insurance services and components
- `@comparit/kv` — Shared health insurance services and components
- `@comparit/sach` — Shared property insurance interfaces
- `@comparit/altersvorsorge` — Shared pension services and components
- `@comparit/copilot-widget` — Bug reporting chatbot widget

### Calculation Flow
1. User fills in Grunddaten (basic data) form
2. Frontend opens a SignalR WebSocket connection to the calculation backend
3. Sends a `SendBerechnungRequest` with all input parameters
4. Backend streams results back via:
   - `ReceiveBerechnungResponse` — individual tariff results
   - `ReceiveVersichererResponse` — insurer-level status
   - `ReceiveSelektionWithReasonsResponse` — excluded tariff reasons
   - `Close` — calculation complete
5. Frontend progressively renders results as they arrive
6. Connection is closed after all results received

---

## 17. UI Components Library

The shared UI library provides these reusable components:
- **Forms**: Input fields, select dropdowns, sliders, checkboxes, toggle switches, number inputs, chips toggle, single-select buttons
- **Layout**: Header, divider, box, box-form, box-toggle, stepper
- **Data display**: Table, list item cards, result response displays
- **Feedback**: Spinner, snackbar notifications, alert messages
- **Dialogs**: Confirmation dialogs, error dialogs
- **Search**: Search filter, select filter, vorgaben filter
- **Special**: Car plate input (for KFZ), IBAN validation, print button, upload box
- **Navigation**: Tab menu, stepper for multi-step forms

---

## 18. Glossary of Key Terms

| German Term | English Translation | Context |
|---|---|---|
| Vergleich | Comparison | The core comparison workflow |
| Sparte | Insurance line/branch | Category of insurance |
| Tarif | Tariff/policy | An insurance product/rate |
| Beitrag | Premium/contribution | The price of insurance |
| Berechnung | Calculation | Server-side tariff calculation |
| Ergebnis | Result | A calculated tariff result |
| Versicherer | Insurer | Insurance company |
| Vermittler | Broker/intermediary | Insurance broker/agent |
| Vermittlergruppe | Broker group | Organization of brokers |
| Kunde | Client/customer | The insured person |
| Vorgang | Case/process | An insurance application case |
| Antrag | Application | Insurance application form |
| Warenkorb | Shopping cart | Selected tariffs for application |
| Grunddaten | Basic data | Initial input form |
| Schutz Optimieren | Optimize protection | Customize coverage requirements |
| Erfüllungsgrad | Fulfillment grade | How well a tariff meets requirements |
| Pflichtleistung | Mandatory benefit | Required coverage attribute |
| Wunschleistung | Desired benefit | Preferred coverage attribute |
| Bausteine | Building blocks | Optional tariff components |
| Dokumentenmappe | Document folder | Collection of application documents |
| Deckungsnote | Coverage note | Preliminary insurance confirmation |
| Anpinnen | Pin | Pin a tariff for easy reference |
| Fremdtarif | External tariff | Third-party tariff not from primary pool |
| Alttarif | Legacy tariff | Existing/old tariff for comparison |
| Referenztarif | Reference tariff | Benchmark tariff for comparison |
| Zahlungsweise | Payment frequency | How often premiums are paid |
| Selbstbehalt/Selbstbeteiligung | Deductible/co-payment | Amount paid by the insured |
| Versicherte Person | Insured person | Person covered by the policy |
| Risikoleben | Term life | Term life insurance |
| Berufsunfähigkeit | Occupational disability | Disability insurance |
| Grundfähigkeit | Basic ability | Basic ability insurance |
| Altersvorsorge | Retirement provision | Pension/retirement planning |
| Sachversicherung | Property insurance | Property/casualty insurance |
| Haftpflicht | Liability | Liability insurance |
| Karenzzeit | Deferred/waiting period | Period before benefits start |
| Effektivkosten | Effective costs | Total cost ratio of a pension product |
| Rentenfaktor | Pension factor | Conversion factor for pension calculations |
| IHK Nummer | Chamber of Commerce number | Broker registration number |
| eVB | Electronic insurance confirmation | Digital proof of KFZ insurance |
| ESG/IDD | Sustainability preferences | EU Insurance Distribution Directive compliance |
