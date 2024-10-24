import * as HttpApi from "@effect/platform/HttpApi"
import * as OpenApi from "@effect/platform/OpenApi"
import { AppApi } from "./delcare"

export class MyHttpApi extends HttpApi.empty.pipe(
  HttpApi.addGroup(AppApi),
  OpenApi.annotate({
    title: "Public Api",
    description: "Public Api"
  })
) {}
