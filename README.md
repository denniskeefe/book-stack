# Book Stack

Two pages for running a small shared library. **Scan** adds books to the shelf with a phone
camera; **Library** shows what's on the shelf, what reading level it is, and who has what out.

## Pages

- `index.html` — the scanner. Point a phone at the barcode on the back of a book and it is
  added to the shared catalogue.
- `dashboard.html` — the shelf, the reader roster, and everything currently checked out.
- `admin.html` — sets the admin password, the second credential that permits deleting.

## How it works

- **Scanning** uses the browser's native `BarcodeDetector` where it exists (Chrome, Android)
  and falls back to [ZXing](https://github.com/zxing-js/library) everywhere else, including
  iOS Safari. Frames are cropped to the reticle before decoding to keep the loop fast.
- **One scan is one copy.** A barcode in the frame is decoded several times a second, so a
  cooldown runs from the last time a code was *seen* rather than from when it was added: a
  book held still stays one entry however long it is held, and the next book is still picked
  up at once. To add a second copy of the same title, take it out of the frame and show it
  again. The cooldown compares ISBNs rather than raw barcode text, since the same book reads
  differently when the decoder picks up the price code printed beside it, and every add path
  — scanned, typed, or sent on from the offline queue — starts it.
- **Lookup** tries Open Library's books API, then its search API, then Google Books. A book
  that matches nothing is still recorded by ISBN and can be retried from the shelf.
- **Covers** are resolved separately from the metadata, because the endpoint that knows a
  title does not always carry its picture. Open Library is asked by ISBN as well, each
  candidate image is loaded before it is kept, and a title with no cover anywhere gets a
  drawn tile: its initials on a colour taken from the ISBN. Every book shows a thumbnail.
- **Reading level** is a grade band: K-2, 3-5, 6-8, 9-12, Adult. No free catalogue publishes
  a reading level, so the band is inferred from the audience and subject wording the lookup
  APIs do return, then left editable — choosing a band marks it as set by hand so a later
  lookup will not overwrite it. `Unknown` is not a choice: a title left without a band stays
  eligible for **Retry lookups**, which re-runs the lookup for anything that failed or
  that came back with no level and no cover.
- **Checkout** is roster-based: readers are added by name, and a book is lent by tapping a
  name and a loan length. There are no accounts and no passwords.
- **Google Books API key** is optional and set as `GOOGLE_BOOKS_KEY` at the top of
  `app.js`. Keyless requests share one daily quota across every anonymous caller, so the
  API answers `429` for a shelf that has made no requests of its own, and Google Books is
  effectively a dead fallback without a key. Get one from the Google Cloud console with
  the Books API enabled, and restrict it by HTTP referrer to this site: the key ships in
  page source, so the referrer restriction is what keeps it yours.
- **Storage** is Postgres on Supabase, in a `library` schema. Scans made while offline are
  queued in `localStorage` and sent when the connection returns.

## Data model

`library.books` holds one row per title with a copy count. `library.readers` is the roster.
`library.loans` is append-mostly: a checkout inserts a row, a return stamps `returned_at`.
Availability is never stored — the `library.catalog` view derives it from open loans, so it
cannot drift. Four triggers enforce the rules a lending shelf needs: a book cannot go out more
times than there are copies, the copy count cannot drop below what is already out, a title
cannot be deleted while a copy of it is in someone's hands, and a reader cannot be deleted
while they still hold a book.

## Access

There are no accounts, but there are two passwords, and both are enforced by Postgres rather
than by the page. Each request carries its credentials as headers, and every row-level
security policy calls a function that compares the header against a bcrypt hash stored in
`library.settings` — a table no policy exposes at all. The hash comparison is wrapped as
`(select library.pass_ok())` so Postgres evaluates it once per query rather than once per row.

- **The shelf passcode** permits reading, adding and editing. Everyone who borrows books types
  it once per device; it is kept in `localStorage` afterwards. The first visitor to an
  unclaimed shelf sets it.
- **The admin password** is the only thing that permits a delete. It is set on `admin.html`,
  which requires the shelf passcode, and it must differ from it. It is held in
  `sessionStorage`, so admin rights end when the tab closes rather than lingering on a shared
  device. Changing it requires the current one.

A delete needs both credentials at once: the admin password to satisfy the delete policy, and
the shelf passcode for the row to be visible to the request in the first place. Neither
password can be recovered — there is no reset, by design, because a reset path reachable from
the page would be a way around the password.

Anyone holding the shelf passcode can still read and edit the whole catalogue. The passcode
keeps out strangers who find the URL, not people you gave it to.

## Running locally

```
python3 -m http.server 8777
```

Then open <http://localhost:8777>. Camera access needs either `localhost` or an `https://`
address — browsers refuse it over plain HTTP on a LAN address.
