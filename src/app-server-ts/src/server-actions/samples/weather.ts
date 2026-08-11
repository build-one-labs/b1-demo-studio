import { B1Action, B1ActionPayload, B1Service } from '@buildone/app-server-tslib';
import { handleExternalHttpRequest } from '@buildone/app-server-tslib/utils';
import { HttpService } from '@nestjs/axios';

class WeatherInfoPayload {
  lat: string;
  lon: string;
  date: string;
}

/**
 * `@nestjs/axios` and `@buildone/app-server-tslib` resolve to different axios
 * installs, so their `AxiosResponse` types are structurally incompatible even
 * though they are the same value at runtime. Deriving the parameter type from
 * the helper itself keeps the call type-safe against whichever copy tslib uses.
 */
type ExternalHttpRequest = Parameters<typeof handleExternalHttpRequest>[0];

@B1Service({ basePath: 'samples' })
export class Weather {
  constructor(private readonly httpService: HttpService) {}

  @B1Action({
    description: 'returns the weather at lat / lon for the supplied date'
  })
  async info({
    body: { lat = '52', lon = '7.6', date = '2025-01-01' }
  }: B1ActionPayload<WeatherInfoPayload, { bar: string }> = {}) {
    const url = `https://api.brightsky.dev/weather?lat=${lat}&lon=${lon}&date=${date}`;

    const request = this.httpService.get(url) as unknown as ExternalHttpRequest;
    const { data } = await handleExternalHttpRequest(request);

    return data;
  }
}
