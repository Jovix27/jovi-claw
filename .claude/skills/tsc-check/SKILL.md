---
name: tsc-check
description: Run TypeScript type-check and fix all errors before build or deploy
tools: Bash, Read, Edit, Grep
---

Run TypeScript compilation check and fix all errors.

## Steps

1. Run `npx tsc --noEmit 2>&1` to get all type errors
2. Parse the output — group errors by file
3. Fix each error:
   - Missing `.js` extensions on ESM imports → add them
   - Type mismatches → fix the types
   - Missing imports → add them
   - `any` where types are needed → infer correct types from usage
4. Re-run `npx tsc --noEmit` until clean
5. Report: "TypeScript clean — ready to build, Boss."

## ESM Import Rule (Critical)
This project uses `"type": "module"` in package.json.
All relative imports MUST use `.js` extension — even when the source file is `.ts`:
```ts
// CORRECT
import { foo } from './utils/foo.js'

// WRONG
import { foo } from './utils/foo'
import { foo } from './utils/foo.ts'
```

## Common Errors
- `Cannot find module` → check the `.js` extension and file exists
- `Type 'X' is not assignable` → check the type definition and match it
- `Property 'X' does not exist` → check the interface/type and add the property if needed
