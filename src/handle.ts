import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import { MyHttpApi } from "./api"
import { AccessTokenString, Account, AccountId, UserId, UserWithSensitive } from "./model"

export const HttpAppLive = HttpApiBuilder.group(MyHttpApi, "app", (handles) =>
  Effect.gen(function*() {
    yield* Effect.log("Hello")

    return handles.pipe(
      HttpApiBuilder.handle("index", () =>
        Effect.gen(function*() {
          const createdAt = yield* DateTime.now
          const updatedAt = yield* DateTime.now

          return UserWithSensitive.make({
            id: UserId.make(1),
            accessToken: Redacted.make(AccessTokenString.make("123")),
            account: Account.make({
              id: AccountId.make(1),
              createdAt,
              updatedAt
            }),
            accountId: AccountId.make(1),
            createdAt,
            updatedAt
          })
        })),
      HttpApiBuilder.handle("health", () => Effect.succeed("ok"))
    )
  }))
