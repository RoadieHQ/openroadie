/*
 * Copyright 2025 Larder Software Limited
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

export const JSONATA_REFERENCE = `
JSONATA SYNTAX REFERENCE:

PATH EXPRESSIONS:
- fieldName              Access top-level field
- obj.nested.field       Nested field access
- arr[0]                 First array item
- arr[-1]                Last array item
- arr.fieldName          Extract field from ALL array items (returns array)

FILTERING:
- arr[quantity > 50]     Filter by condition
- arr[status = "active"] Filter by equality
- arr[a > 10 and b < 5]  Multiple conditions

OBJECT CONSTRUCTION:
- { "key": value, "other": field }           Create new object
- arr.{ "newKey": oldKey, "x": nested.val }  Transform each array item

VARIABLES:
- $                      Current context value
- $$                     Root of input data

STRING OPERATIONS:
- firstName & " " & lastName    Concatenation
- $lowercase(str)               Lowercase
- $uppercase(str)               Uppercase
- $substring(str, start, len)   Substring
- $contains(str, pattern)       Check if string contains substring

BOOLEAN OPERATIONS:
- $not(expr)             Negate a boolean
- $exists(field)         Check if field exists

ARRAY FUNCTIONS:
- $count(arr)            Count items
- $sum(arr)              Sum numbers
- $map(arr, fn)          Transform each item
- $filter(arr, fn)       Filter items

IMPORTANT: ALL built-in functions MUST use the $ prefix.
- CORRECT: $not(...), $contains(...), $lowercase(...)
- WRONG:   not(...), contains(...), lowercase(...)

CONDITIONALS:
- condition ? trueVal : falseVal
`.trim();
