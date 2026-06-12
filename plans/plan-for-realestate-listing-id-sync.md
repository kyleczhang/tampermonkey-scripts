# Real Estate Listing ID export/inject buttons

Add two buttons to the right-hand action area of the realestate.com.au header on property search pages, positioned to the left of the existing "Collections" button. The first button exports/copies the listing ID array; the second button, to the right of the export button, injects and merges a listing ID array in one click. Both buttons should show a small notification reporting the result of the action to the user.

See `dom-snapshots/realestate-header.html` for a reference of the header DOM. In that snapshot the right-hand action area sits inside the `.wikxrb1` / `.aanvpa5` containers within `header.wikxrb4`, and the existing order is "Collections", Notifications, "My account"; the new button group should be inserted in front of "Collections", in the order export button, inject/merge button, "Collections". The snapshot is only meant to help understand the insertion position and the structure of neighbouring elements; the implementation should not depend on the full, volatile class-name strings.

The header has two states and the buttons must appear in both. When the user is signed in, the header shows the "Collections" link (anchored via `a[aria-label="Collections"]`) and the buttons go in front of it. When the user is signed out there is no "Collections" link; instead the action area shows "Sign in" and "Join" buttons (see the logged-out variant where the action area becomes `.wikxrb1` / `.aanvpa4` with "Sign in" and "Join"). In that case the buttons should be anchored in front of the first of those (the "Sign in" button), matched by its button text rather than by volatile class names. If neither anchor is present yet (the header has not mounted), do nothing and try again on the next poll, so the buttons are inserted once the header exists and re-inserted after SPA navigation remounts the header.

The localStorage key is `previewedIds`. Its value is the string array of property listing IDs that back the map's grey-dot / visited state, read as a JSON array; if the key is missing or its content is unusable, treat it as an empty array.

Export and inject must use one and the same raw format so the round-trip stays coherent: the full raw text the export button copies to the clipboard should be directly usable by the inject/merge button on another device or in another session, without the user having to edit it, wrap it in a variable name, delete comments, or reformat it by hand. That raw format is simply a JSON string array, e.g. the content produced by `JSON.stringify(listingIds)`; the inject/merge button's clipboard read and its manual-paste fallback should both parse the same JSON string array.

When the export button is clicked, the script should read the visited property listing ID array saved in localStorage under the current domain, serialize that array into the JSON string array raw format above, and copy it to the clipboard. On success, notify the user that it has been copied and show the number of copied listing IDs. On failure, notify the user that the copy failed and keep a clear error log so it can be diagnosed in the browser Console.

When the inject/merge button is clicked, the script should first try to read the raw text produced by the export button from the clipboard. Reading the clipboard in Tampermonkey/the browser usually has to happen after an explicit user gesture such as a button click, and it can fail because of permissions, browser settings, or the API being unavailable; if the clipboard read fails or is unavailable, provide a manual-paste fallback so the user can paste the raw text produced by the export button directly and continue the merge/inject. Once the array to inject is obtained, merge and de-duplicate it with the existing `previewedIds` in localStorage and write the result back. On success, notify the user that it has been merged and show the imported count and the total count after merging; then reload the page so realestate.com.au re-reads localStorage and updates the map's grey-dot state. When the clipboard or manual-paste content is not a valid JSON string array, or the read, the parse, or the localStorage write fails, notify the user of the reason and keep a clear error log.

The variable-name conventions used in these requirements are: `previewedIds` is the localStorage key; `listingIds` is the listing ID array read and parsed during export; `serializedListingIds` is the string content prepared for the clipboard; `incomingListingIds` is the listing ID array parsed from the clipboard or manual-paste content during injection; `existingListingIds` is the listing ID array already present in localStorage before injection; `mergedListingIds` is the de-duplicated, merged listing ID array prepared to be written back to localStorage.

## Reference code

The following code only illustrates the meaning of the two actions; the actual implementation may reorganize it around Tampermonkey script structure, button events, notification UI, the clipboard API, and error handling.

Export/copy action reference:

```javascript
// Read the saved visited listing IDs from localStorage.
const listingIds = JSON.parse(localStorage.getItem("previewedIds") || "[]");

// Serialize the listing ID array for clipboard export.
const serializedListingIds = JSON.stringify(listingIds);

// Copy the serialized listing IDs to the clipboard.
copy(serializedListingIds);

// Report the export result for debugging.
console.log(
  "Visited listing ID count:",
  listingIds.length,
  "Copied to clipboard",
);
```

Inject/merge action reference:

```javascript
// This should be the exact raw text produced by the export action.
const serializedListingIds = '["444335800","431339790","444357960"]';

// Parse the exported raw text directly, without requiring the user to edit it.
const incomingListingIds = JSON.parse(serializedListingIds);

// Read the existing visited listing IDs from localStorage.
const existingListingIds = JSON.parse(
  localStorage.getItem("previewedIds") || "[]",
);

// Merge and de-duplicate the existing and incoming listing IDs.
const mergedListingIds = [
  ...new Set([...existingListingIds, ...incomingListingIds]),
];

// Save the merged listing IDs back to localStorage.
localStorage.setItem("previewedIds", JSON.stringify(mergedListingIds));

// Reload the page so realestate.com.au refreshes the map visited state.
location.reload();
```
