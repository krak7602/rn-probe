## MODIFIED Requirements

### Requirement: JS error reporting
The system SHALL report JS errors. On new arch, it SHALL use the CDPBridge error buffer (populated via `Runtime.exceptionThrown` events) as the primary source. On legacy arch, it SHALL fall back to querying Metro `/status` for build errors.

#### Scenario: Errors from CDP (new arch)
- **WHEN** user runs `rn errors` and CDPBridge is active
- **THEN** MetroBridge delegates to `CDPBridge.getErrors()` and returns the result

#### Scenario: Build error from Metro (legacy or new arch)
- **WHEN** Metro `/status` returns `type: "BundleTransformError"`
- **THEN** MetroBridge includes the Metro build error in addition to any runtime errors from CDPBridge

#### Scenario: No errors
- **WHEN** no runtime or build errors are present
- **THEN** the CLI prints `No errors.`
