# Inline Calculations

Inline calculations run directly from comments in C/C++ (and YAML comments).

## Syntax

```c
// @vin = 12V
// @r = 4.7kOhm
// = @vin / @r -> mA

// = 25% * 200W -> W
// = 100 bar + 10 kPa -> atm
```

## Capabilities

- Variable assignment via `@name = ...`
- Unit-aware evaluation and conversion (`-> unit`)
- Dimensional checks with warnings/errors
- CodeLens + hover output

## Ignore Directives

```c
// = BAD_EXPR #calcdocs-ignore-error
// = A + B #calcdocs-ignore-warning
// calcdocs-ignore-line; = anything
```

Supported directives:

- `#calcdocs-ignore`
- `#calcdocs-ignore-error`
- `#calcdocs-ignore-warning`
- `#calcdocs-ignore-info`
- `calcdocs-ignore-line;`

## Relevant Settings

- `calcdocs.inline.codeLens.enabled`
- `calcdocs.inline.hover.enabled`
- `calcdocs.inline.diagnostics.level`

