# Book Pile

Two pages for running a small shared library. **Scan** adds books to the shelf with a phone
camera; **Library** shows what's on the shelf, what reading level it is, and who has what out.

## Pages

- `index.html` — the scanner. Point a phone at the barcode on the back of a book and it is
  added to the shared catalogue.
- `dashboard.html` — the shelf, the reader roster, and everything currently checked out.

## How it works

- **Scanning** uses the browser's native `BarcodeDetector` where it exists (Chrome, Android)
  and falls back to [ZXing](https://github.com/zxing-js/library) everywhere else, including
  iOS Safari. Frames are cropped to the reticle before decoding to keep the loop fast.
- **Lookup** tries Open Library's books API, then its search API, then Google Books. A book
  that matches nothing is still recorded by ISBN and can be retried from the shelf.
- **Reading level** is a grade band: K-2, 3-5, 6-8, 9-12, Adult. No free catalogue publishes
  a reading level, so the band is inferred from the audience and subject wording the lookup
  APIs do return, then left editable — changing it marks the band as set by hand so a later
  lookup will not overwrite it.
- **Checkout** is roster-based: readers are added by name, and a book is lent by tapping a
  name and a loan length. There are no accounts and no passwords.
- **Storage** is Postgres on Supabase, in a `library` schema. Scans made while offline are
  queued in `localStorage` and sent when the connection returns.

## Data model

`library.books` holds one row per title with a copy count. `library.readers` is the roster.
`library.loans` is append-mostly: a checkout inserts a row, a return stamps `returned_at`.
Availability is never stored — the `library.catalog` view derives it from open loans, so it
cannot drift. Two triggers enforce the rules a lending shelf needs: a book cannot go out more
times than there are copies, and the copy count cannot drop below what is already out.

## Access

There is no sign-in. Row-level security lets anyone holding the site URL read, add and update
rows, and lets nobody delete them. That is the trade for a shelf a child can use without a
password — treat the URL like a key to the room, and note that anyone who has it can also
edit the catalogue.

## Running locally

```
python3 -m http.server 8777
```

Then open <http://localhost:8777>. Camera access needs either `localhost` or an `https://`
address — browsers refuse it over plain HTTP on a LAN address.
