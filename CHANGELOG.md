# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2026-03-08

### Added

- **config:** Replace Linear keys with Huly auth config
- **huly:** Add client factory with env validation
- **huly:** Add project auto-creation utility
- **huly:** Implement error classifier for Huly API
- **huly:** Rewrite core issue functions (search, get, update, archive)
- **huly:** Rewrite project functions (list, create, update, archive)
- **huly:** Rewrite issue-label functions (add, remove)
- **huly:** Rewrite comment functions (add, get, update, remove)
- **tools:** Update factory and bot for Huly auth
- Complete Linear to Huly migration

### Changed

- Rename src/linear to src/huly
- **errors:** Rename LinearError to HulyError
- Remove remaining linear references
- **huly:** Extract shared utilities to eliminate code duplication
- **huly:** Apply withClient wrapper and shared fetchers to all operation files

### Documentation

- Add design and implementation plan for automated Huly user registration
- Update documentation for Linear to Huly migration

### Fixed

- **deps:** Remove broken @hcengineering packages - core and ui not in registry
- **huly:** Resolve type errors in refactored utilities and tests
- **huly:** Address utility review feedback
- **huly:** Classify getClient failures in withClient

### Miscellaneous

- Add GitHub Packages authentication for @hcengineering

### Styling

- Fix lint issues
- Apply formatting fixes via pre-commit hook

### Testing

- Fix failing tests for Huly migration

### Deps

- Add Huly API client packages
- Add Huly API client packages
- Remove @linear/sdk, complete migration to Huly

[2.0.0]: https://github.com/wKich/papai/compare/v1.1...v2.0.0

