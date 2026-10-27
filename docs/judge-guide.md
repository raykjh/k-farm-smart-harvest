# K-Farm Judge Quick Start

[Open the public app](https://kfarm.1gaji.com) · [Watch the current 2:58 video](https://youtu.be/owk6Hm48ITs) · [Devpost submission](https://devpost.com/software/k-farm-smart-harvest)

K-Farm connects crop decisions to the work needed to carry them out through local agricultural support centers. This guide follows the submitted application: register a field, provide its conditions, let AI evaluate crop options, apply the plan, and inspect the saved changes.

This guide follows the October 27 crop-planning release, application commit 1bc233baa9c6b28c2ac18a28fcc09bed72657e4f; see the [final freeze record](submission-freeze.md). The existing screens and test inputs are retained, and the public database remains writable. The linked October 28 video shows the public application and separately dated October 27 validation evidence. No new model call or approval was performed during filming. Generated tractor/drone imagery illustrates future work, not connected hardware. The video and revised Devpost wording have been published after owner review.

## 1. Sign in and look around

Open the app and click **Sign in** using the prefilled judge credentials. No account creation, provider login or API key is required. Keep **English** selected. The account operates the **Gyebuk-myeon Agriculture Support Center**.

For a short inspection before entering anything:

| Screen | What to inspect |
|---|---|
| **Field management → Manage → Crop / production** | A parcel's saved crop, cultivation period and next task. The filmed parcel **1537, Wonchon-ri** has a saved spring-potato plan. |
| **Manage → Work history** | Planned work and recorded outcomes. Future tasks marked **Awaiting result** are not completed farming. |
| **Schedule → 2027** | Use the month shown on a parcel's next task; March/June include potato work, while May/October include rice work. An empty calendar for today in 2026 is expected. |
| **Equipment → machine details** and **Labor** | Equipment reservations and labor demand. A next-year labor requirement is not confirmed attendance. |
| **National overview → 2027** | Crop areas, expected output and progress across participating centers. Select Gyebuk to inspect this center's contribution. |
| **Prices**, **Costs and economics**, **Supply outlook**, **Climate information** | Available references, their sources and dates. Evidence coverage differs by crop. |

The post-filming check on October 21 showed **84 Gyebuk fields** and **308 approved cultivation cycles across four centers, covering 54.7 ha of cycle area** for 2027. These are a dated starting point, not fixed expected totals: other judges can add records. The national screen covers participating fields, not every farm in Korea.

## 2. Enter a new field

Start with **one row** from the ten examples below. The remaining rows provide alternatives or inputs for a small mixed batch. Note the existing field count and the 2027 Gyebuk totals first so that you can compare them afterward.

### A. Farmer

1. Open **Field management → Register new field**, or **Main → Register field**.
2. Copy the example's **Name**, **Date of birth** and **Phone**. Enter the birth date as eight digits; the form adds separators.
3. For **Address**, use `Fictional judge test residence, Gyebuk-myeon`. This is the applicant's address field, separate from the parcel lookup.
4. Leave **Contact method** as **SMS** and click **Next**. The hosted demonstration does not send real SMS.

### B. Fields

1. Click **Look up owned fields**, then **Add field by parcel address**. Ownership lookup is not connected; these are fictional owner declarations awaiting review.
2. Paste the complete Korean **Parcel search address** from a row below and click **Search VWorld parcels**. Use the Korean text for lookup even in English mode.
3. Choose the exact lot with **Select parcel**, wait for its boundary preview, then click **Add parcel to draft**.
4. Enter the example's **Work area (m²)** and **Land type**: **Upland** for profile A or **Paddy** for profile B. Keep the parcel selected.
5. Click **Save selected fields**, then **Next**. This saves the selection inside the form; the application is submitted in the following step.

### C. Confirm delegation and conditions

1. Leave **Service start** at today's prefilled date. For these examples, set **Service end** to `2027-12-31`. A future service start such as `2027-01-01` leaves planning waiting until that date.
2. Expand **Reviewed field and climate conditions**, then the parcel's **Field / regional conditions and recommendation evidence**. Enter profile A or B from the table below; do not leave the required conditions at **Unknown**.
3. Set **Reviewed on** to today's date shown in the app. Paste the supplied fictional-evidence statement.
4. Check the consent confirmation for this fictional test scenario, then click **Next**. At this final step, **Next submits and saves the application**. Wait for **Application received**; do not submit the same parcel again after an uncertain response.

Complete registrations can enter the background AI review workflow. Registering a person and field does not itself mean a crop plan has been approved, nor does it enroll the owner as a worker.

### Ten fictional input examples

These are **inputs, not predetermined AI results**. Names, birth dates, non-contact phone placeholders, areas and condition profiles are fictional. The parcel addresses are real public map references and do not identify the applicants' property or establish ownership, consent, land classification or agronomic suitability.

All ten addresses and boundary lookups were checked on October 21, 2026, and none appeared in the Gyebuk managed-field list at that check. They were **not submitted or AI-planned while preparing this guide**. If a parcel is already registered when you test, use a different row; do not overwrite an existing record. Add your own short suffix to the applicant name to distinguish your test.

| Name | Date of birth | Phone placeholder | Parcel search address — copy in full | Work area (m²) | Profile |
|---|---|---|---|---:|---|
| Judge Demo 01 Minji Kim | `19530312` | `000-0000-0001` | 전북특별자치도 장수군 계북면 원촌리 1545 | 2000 | A |
| Judge Demo 02 Jisoo Lee | `19550724` | `000-0000-0002` | 전북특별자치도 장수군 계북면 원촌리 1546 | 1000 | A |
| Judge Demo 03 Junho Park | `19481105` | `000-0000-0003` | 전북특별자치도 장수군 계북면 원촌리 1547 | 1200 | A |
| Judge Demo 04 Yuna Choi | `19590218` | `000-0000-0004` | 전북특별자치도 장수군 계북면 원촌리 1548 | 1500 | A |
| Judge Demo 05 Doyun Jung | `19510609` | `000-0000-0005` | 전북특별자치도 장수군 계북면 원촌리 1549 | 1800 | A |
| Judge Demo 06 Hana Kang | `19460927` | `000-0000-0006` | 전북특별자치도 장수군 계북면 원촌리 1550 | 800 | A |
| Judge Demo 07 Seojun Cho | `19540421` | `000-0000-0007` | 전북특별자치도 장수군 계북면 원촌리 1551 | 1000 | B |
| Judge Demo 08 Sujin Yoon | `19571203` | `000-0000-0008` | 전북특별자치도 장수군 계북면 원촌리 1552 | 1300 | B |
| Judge Demo 09 Minho Jang | `19490816` | `000-0000-0009` | 전북특별자치도 장수군 계북면 원촌리 1553 | 1600 | B |
| Judge Demo 10 Eunji Han | `19560214` | `000-0000-0010` | 전북특별자치도 장수군 계북면 원촌리 1554 | 2000 | B |

### Conditions to enter

Use these assumptions only for the fictional judge scenario. In real operation, the center would need reviewed field and regional evidence.

| Field label | Profile A — upland comparison | Profile B — paddy case |
|---|---|---|
| Current land use | Upland | Paddy |
| Cadastral classification | Upland | Paddy |
| Growing environment | Open field | Open field |
| Water supply | Yes | Yes |
| Drainage | Good | Good |
| Machine access | Yes | Yes |
| Required labor | Yes | Yes |
| Reviewed region — copy exactly | `계북면` | `계북면` |
| Rice · Regional / variety assessment | Unsuitable | Suitable |
| Spring potato · Regional / variety assessment | Suitable | Unsuitable |
| Pepper · Regional / variety assessment | Suitable | Unsuitable |
| Reviewed on | Today's date shown in the app | Today's date shown in the app |

Paste into **Sources, variety, reviewer and field evidence**:

```text
Judge demo only. Fictional owner, work area and reviewed conditions for testing the software. Public parcel reference only; no ownership, consent or agronomic certification.
```

**Required labor = Yes** is a field-condition assumption, not the creation of workers or confirmation of attendance. Leave other crop candidates unchanged. The three assessment controls above are already present; **Add crop for review** adds a candidate assessment, not a saved cultivation.

## 3. Let AI choose and apply the crop plan

Return to **Field management** and click **Apply AI plans** once. This is an execution command: it requests actual NVIDIA Nemotron planning through Nebius Token Factory, checks the calculated alternatives and current records, and saves plans that pass validation.

The command can cover other eligible, uncommitted fields in the same center as well as your new parcel. Wait for the success message, such as **Applied … fields / … tasks**, or read the reported hold/error. Do not repeatedly click while a request is running.

For this delegated workflow, you **do not manually choose and register the final crop**. You supply the conditions; AI evaluates the eligible crop/resource alternatives. Applying a valid plan registers its chosen crop, cultivation period and associated work. Profile A allows a potato/pepper comparison; profile B exercises a paddy scenario. Neither profile promises a particular output or successful schedule under every resource condition.

If the registration receipt instead shows a background review awaiting confirmation, inspect **View work, equipment and labor plan**, select **Include this plan for approval**, acknowledge the review and use **Approve … selected field plans**. This is a separate saved-draft path; do not perform both approval paths for an already-applied cultivation.

## 4. Where the changes appear

| After this action | Where to look | Expected change |
|---|---|---|
| Submit the field application | **Field management** map and list; **Manage → Owner / Field details** | A new parcel and applicant link, entered area and conditions. A crop can still be pending. |
| Apply or approve a valid crop plan | **Manage → Crop / production** | The selected crop, future cultivation dates, next task and cultivation history. A 2027 crop may appear as **Next cultivation**, not **Current cultivation**. |
| Save the plan | **Manage → Work history** and **Schedule → 2027** | Planned tasks on their assigned dates. Their number and timing depend on the selected plan. |
| Save resource assignments | **Equipment → relevant machine details**; **Labor** | Saved reservations and labor requirements where applicable. Unsecured resources remain needs; planning does not imply confirmed attendance. |
| Save a cultivation cycle | **National overview → 2027 → Gyebuk** | Approved cycle count, crop area and composition update. Expected output appears where the required reference is available; registration alone is not approved cultivation. |
| Reload, or sign out and sign back in | Reopen your parcel and the same year/month | Saved records remain. This is persistence, not another AI decision. |

No harvest, shipment or completed-work total should rise merely because a plan was saved. Compare your parcel and before/after totals rather than expecting a fixed national number in this shared test environment.

## 5. If a test pauses

| What you see | What to check |
|---|---|
| No parcel or boundary result | Copy the complete Korean address, select the exact lot and retry the lookup. If the provider is unavailable, inspect an existing field. |
| Parcel already registered | Pick another example. Existing fields and other judges' work are shared records. |
| Waiting for participation to start | Keep **Service start** at today; the planned cultivation itself can start in 2027. |
| No eligible plan or missing conditions | Check both expanded condition sections, the exact region `계북면`, crop assessments, review date and evidence. Existing inputs can be reviewed under **Manage → Field details → Edit field conditions**. |
| AI/provider/budget error | Live inference uses a shared, bounded allowance. Read the message; do not keep resubmitting or treat a failed call as success. Saved records and the final video remain available. |
| Record changed or request interrupted | Reload and inspect your parcel or **Check result**, if offered, before making another request. Another judge or the background worker may have changed the shared state. |

## What this demonstrates

The system connects actual model decisions, calculation and validation, staff application/approval, and persistent crop/work/resource records. Earlier comparisons matched the deterministic baseline. Three October 27 comparisons against an earlier local AI adviser found one lower-labor crop mix, one tie and one recovery from a rejected selection. The final revision separately completed actual-model planning across simulated 2026 and 2027 seasons while preserving earlier records. These checks do not establish a national optimum or real farming results. See the dated [AI decision evidence](ai-decision-evidence.md) and [verification record](verification.md) for version and environment boundaries.

Use fictional personal details. Real SMS, payroll, purchases and machine commands are not executed. The judge account cannot administer accounts or reset the dataset. The prior October 21 release tag remains immutable. Normal judge inputs and records can accumulate; a release does not reset the dataset or replenish the inference allowance.
