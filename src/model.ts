import * as Schema from "@effect/schema/Schema"
import * as Model from "@effect/sql/Model"

export const UserId = Schema.Number.pipe(Schema.brand("UserId"))
export type UserId = typeof UserId.Type

export const UserIdFromString = Schema.NumberFromString.pipe(
  Schema.compose(UserId)
)
export const AccountId = Schema.Number.pipe(Schema.brand("AccountId"))
export type AccountId = typeof AccountId.Type

export class Account extends Model.Class<Account>("Account")({
  id: Model.Generated(AccountId),
  createdAt: Model.DateTimeInsert,
  updatedAt: Model.DateTimeUpdate
}) {}

export const AccessTokenString = Schema.String.pipe(Schema.brand("AccessToken"))
export const AccessToken = Schema.Redacted(AccessTokenString)
export type AccessToken = typeof AccessToken.Type

export class User extends Model.Class<User>("User")({
  id: Model.Generated(UserId),
  accountId: Model.GeneratedByApp(AccountId),
  accessToken: Model.Sensitive(AccessToken),
  createdAt: Model.DateTimeInsert,
  updatedAt: Model.DateTimeUpdate
}) {}

export class UserWithSensitive extends Model.Class<UserWithSensitive>(
  "UserWithSensitive"
)({
  ...Model.fields(User),
  accessToken: AccessToken,
  account: Account
}) {}
