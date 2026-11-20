# Core Contracts

## Trust zones
- PUBLIC: user-facing requests and responses.
- ADMIN: founder-only control operations.

## Control flow
PUBLIC -> controlled API boundary -> ADMIN services.

The public application never receives admin credentials or internal control tokens.
