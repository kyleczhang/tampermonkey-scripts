# YouTube Custom Keyboard Shortcut Script — Requirements

## 1. Background

This document describes a custom keyboard-shortcut script for the YouTube web player. The script is intended to run on `youtube.com` pages via Tampermonkey.

The user wants more comfortable key bindings to control YouTube playback speed and seek forward / backward, while triggering YouTube's native playback feedback animations as much as possible — rather than silently changing the player state with no visual cue.

Known background:

- The playback-rate step is `0.25`.
- YouTube's native shortcuts trigger both the speed change and an on-screen feedback animation.
- Calling `video.playbackRate = ...` or `player.setPlaybackRate(...)` directly changes the speed but does **not** trigger YouTube's native animation.
- Simulating YouTube's native shortcut key events can, in some cases, trigger the native animation.

## 2. Goals

Implement a YouTube custom-shortcut script providing the following:

1. Press `[` to lower the playback speed by one step (i.e. by `0.25`).
2. Press `]` to raise the playback speed by one step (i.e. by `0.25`).
3. Press `\` to toggle between `1.0x` and the most recent non-`1.0x` speed. Rules:
   - If the current speed is not `1.0x`, record the current speed and switch to `1.0x`.
   - If the current speed is `1.0x` and a non-`1.0x` speed was previously recorded, switch back to that recorded speed.
   - If the current speed is `1.0x` and no non-`1.0x` speed was ever recorded, switch to the default speed `2.0x`.
4. Press `'` to simulate YouTube's native seek-forward action.
5. Press `;` to simulate YouTube's native seek-backward action.

The script should, wherever possible, trigger YouTube's built-in visual feedback animations by simulating the native shortcuts.

## 3. Scope

### 3.1 Target sites

The script should run on:

```text
https://www.youtube.com/*
```

## 4. Shortcut requirements

### 4.1 Lower playback speed

Key:

```text
[
```

Behavior:

- Lower the current playback speed by `0.25`.
- Should simulate YouTube's native speed-down shortcut, i.e. `Shift + ,`.

Examples:

```text
1.00x -> 0.75x
0.75x -> 0.50x
0.50x -> 0.25x
```

### 4.2 Raise playback speed

Key:

```text
]
```

Behavior:

- Raise the current playback speed by `0.25`.
- Should simulate YouTube's native speed-up shortcut, i.e. `Shift + .`.

Examples:

```text
1.00x -> 1.25x
1.25x -> 1.50x
1.50x -> 1.75x
1.75x -> 2.00x
```

### 4.3 Toggle between 1.0x and the current speed

Key:

```text
\
```

Behavior:

- If the current playback speed is not `1.0x`:
  - Record the current playback speed.
  - Switch the playback speed to `1.0x`.
- If the current playback speed is `1.0x`:
  - If a non-`1.0x` speed was recorded earlier, switch back to it.
  - If no non-`1.0x` speed was recorded, switch to `2.0x`.

Example 1:

```text
Current speed is 1.75x
Press \ -> switch to 1.00x
Press \ again -> switch back to 1.75x
```

Example 2:

```text
Current speed is 1.00x
No speed recorded previously
Press \ -> switch to 2.00x
Press \ again -> switch back to 1.00x
```

Example 3:

```text
Current speed is 2.00x
Press \ -> switch to 1.00x
User manually changes to 1.50x
Press \ -> switch to 1.00x, recording 1.50x
Press \ again -> switch back to 1.50x
```

Implementation requirements:

- When switching speed, prefer simulating YouTube's native speed shortcuts to step through one notch at a time.
- If the target speed is several steps away from the current speed, simulate the native shortcut multiple times in succession.
- Insert a short delay between each simulated keypress, e.g. `50ms` to `100ms`, to avoid YouTube mishandling rapid consecutive events.

#### Optimized logic for the `\` speed toggle

When `\` toggles between `1.0x` and some non-`1.0x` speed, the script should avoid simulating the native shortcut many times in a row, because that fires YouTube's native animation repeatedly, which looks inelegant.

Therefore, when the target speed differs from the current speed by more than `0.25`, use a hybrid approach:

1. First, silently (without simulating shortcuts) set the playback speed to the notch adjacent to the target speed.
2. Then simulate the native YouTube shortcut once to let YouTube perform the final one-notch change.
3. This still triggers a single YouTube native speed animation, but not several.

Specific rules:

- If the target speed is higher than the current speed:
  - First silently set to `targetRate - 0.25`.
  - Then simulate `Shift + .` once.
- If the target speed is lower than the current speed:
  - First silently set to `targetRate + 0.25`.
  - Then simulate `Shift + ,` once.

Example 1:

```
Current speed: 2.0x
Target speed:  1.0x

Not recommended:
Simulate Shift + , four times in a row
Triggers the YouTube native animation 4 times

Recommended:
Silently set to 1.25x first
Then simulate Shift + , once
Ends at 1.0x
Triggers the YouTube native animation only once
```

Example 2:

```
Current speed: 1.0x
Target speed:  2.0x

Not recommended:
Simulate Shift + . four times in a row
Triggers the YouTube native animation 4 times

Recommended:
Silently set to 1.75x first
Then simulate Shift + . once
Ends at 2.0x
Triggers the YouTube native animation only once
```

If the current speed and target speed differ by only `0.25`, no silent set is needed — just simulate the native shortcut once.

If the current speed already equals the target speed, do nothing.

### 4.4 Simulate seek forward

Key:

```text
'
```

Behavior:

- On `'`, simulate YouTube's native seek-forward shortcut.
- Simulate the `→` key, i.e. YouTube's native seek-forward shortcut.
- Try to trigger YouTube's native fast-forward animation.

Note:

- Do not use `video.currentTime += 10` as the primary approach, because it usually does not trigger YouTube's native animation.

### 4.5 Simulate seek backward

Key:

```text
;
```

Behavior:

- On `;`, simulate YouTube's native seek-backward shortcut.
- By default simulate the `←` key, i.e. YouTube's native seek-backward shortcut.
- Try to trigger YouTube's native rewind animation.

Note:

- Do not use `video.currentTime -= 10` as the primary approach, because it usually does not trigger YouTube's native animation.

## 5. Playback-speed rules

### 5.1 Speed range

No need to enforce a playback-speed range; simply simulate the shortcuts.

## 6. Input-context restrictions

To avoid interfering with normal typing, the script must not respond to its custom shortcuts in the following contexts:

- Focus is in the search box.
- Focus is in the comment input.
- Focus is in any `<input>` element.
- Focus is in any `<textarea>` element.
- Focus is in any `contenteditable` element.
- The user is typing a comment, title, description, or other text content.
