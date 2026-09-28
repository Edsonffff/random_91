import React, { useState } from 'react';
import type { ApiEndpointSpec, HttpMethod } from '../../types/api';
import { resultApiService } from '../../services/resultApi';
import { useToast } from '../../context/ToastContext';
import { Play, Copy, Check, Terminal, Server } from 'lucide-react';

const ENDPOINTS: ApiEndpointSpec[] = [
  {
    id: 'post-merchant-token',
    name: '5.1 Sanctum Bearer Token Auth',
    method: 'POST',
    path: '/api/merchant/token',
    description: 'Issues a Sanctum Bearer token for authenticated server-to-server operations.',
    defaultBody: {
      login: 'blessedson401',
      password: '●●●●●●●●●●',
      device_name: 'backend-service',
    },
    exampleResponse: {
      status: 'success',
      token_type: 'Bearer',
      access_token: '1|eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
      device_name: 'backend-service',
      message: 'Sanctum Bearer token generated for sandbox operations',
    },
  },
  {
    id: 'set-custom-result',
    name: '5.2 Set Custom Winning Number Override',
    method: 'POST',
    path: '/merchant/api/set_merchant_custom_result.php',
    description:
      'Programmatically forces a specific winning number for upcoming periods (0-9 for WinGo, 3-18 for K3).',
    defaultBody: {
      game_code: 'WinGo_30S',
      period_number: '20260920000001',
      winning_number: 0,
      allow_replace: '1',
    },
    exampleResponse: {
      status: 'success',
      code: 200,
      message: 'Winning number set successfully',
      data: {
        game_code: 'WinGo_30S',
        period_number: '20260920000001',
        winning_number: 0,
        size: 'Small',
        colors: ['red', 'violet'],
        is_test_override: true,
      },
    },
  },
  {
    id: 'get-custom-results',
    name: '5.3 Fetch Active Custom Results',
    method: 'GET',
    path: '/merchant/api/get_merchant_custom_results.php',
    description: 'Fetches recent custom winning number overrides configured for merchant domains.',
    defaultParams: { game: 'WinGo_30S' },
    exampleResponse: {
      status: 'success',
      code: 200,
      count: 9,
      results: [
        {
          period_number: '20260928100050373',
          winning_number: 0,
          game_code: 'WinGo_30S',
          size: 'Small',
          colors: ['red', 'violet'],
        },
      ],
    },
  },
  {
    id: 'get-current-period',
    name: 'Get Current Period Sequence',
    method: 'GET',
    path: '/api/test/current-period',
    description: 'Retrieves current period details and next predicted draw sequence.',
    defaultParams: { game_code: 'WinGo_30S' },
    exampleResponse: {
      game_code: 'WinGo_30S',
      period_number: '20260928100050374',
      timestamp: '2026-09-28T09:10:00.000Z',
      next_period_number: '20260928100050375',
      draw_interval_seconds: 30,
    },
  },
];

export const ApiConsole: React.FC = () => {
  const [selectedEndpointId, setSelectedEndpointId] = useState<string>(ENDPOINTS[1].id);
  const [requestBodyText, setRequestBodyText] = useState<string>(
    JSON.stringify(ENDPOINTS[1].defaultBody, null, 2)
  );
  const [paramInput, setParamInput] = useState<string>('WinGo_30S');
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [lastResponse, setLastResponse] = useState<unknown>(null);
  const [lastStatus, setLastStatus] = useState<number | null>(null);
  const [responseTime, setResponseTime] = useState<number | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const { showToast } = useToast();

  const currentEndpoint = ENDPOINTS.find((e) => e.id === selectedEndpointId) || ENDPOINTS[1];

  const handleSelectEndpoint = (ep: ApiEndpointSpec) => {
    setSelectedEndpointId(ep.id);
    setLastResponse(null);
    setLastStatus(null);
    if (ep.defaultBody) {
      setRequestBodyText(JSON.stringify(ep.defaultBody, null, 2));
    }
  };

  const handleRunRequest = async () => {
    setIsRunning(true);
    const start = performance.now();
    try {
      if (currentEndpoint.id === 'post-merchant-token') {
        const parsed = JSON.parse(requestBodyText);
        setLastResponse({
          status: 'success',
          token_type: 'Bearer',
          access_token: 'mock_sanctum_' + Math.random().toString(36).substring(2, 18),
          device_name: parsed.device_name || 'backend-service',
          created_at: new Date().toISOString(),
          sandbox_verified: true,
        });
        setLastStatus(200);
      } else if (currentEndpoint.id === 'set-custom-result') {
        const parsed = JSON.parse(requestBodyText);
        const res = await resultApiService.createTestResult({
          gameCode: parsed.game_code || parsed.gameCode || 'WinGo_30S',
          periodNumber: parsed.period_number || parsed.periodNumber,
          winningNumber: Number(parsed.winning_number !== undefined ? parsed.winning_number : parsed.winningNumber),
          allowReplace: true,
        });
        setLastResponse({
          status: 'success',
          code: 200,
          message: 'Winning number set successfully in test sandbox',
          data: {
            game_code: res.gameCode,
            period_number: res.periodNumber,
            winning_number: res.winningNumber,
            size: res.size,
            colors: res.colors,
            is_test_override: true,
            timestamp: res.createdAt,
          },
        });
        setLastStatus(200);
      } else if (currentEndpoint.id === 'get-custom-results') {
        const res = await resultApiService.getResults(paramInput.trim() || 'WinGo_30S', 10);
        setLastResponse({
          status: 'success',
          code: 200,
          count: res.length,
          results: res.map((r) => ({
            id: r.id,
            game_code: r.gameCode,
            period_number: r.periodNumber,
            winning_number: r.winningNumber,
            size: r.size,
            colors: r.colors,
            status: r.status,
          })),
        });
        setLastStatus(200);
      } else if (currentEndpoint.id === 'get-current-period') {
        const res = await resultApiService.getCurrentPeriod(paramInput.trim() || 'WinGo_30S');
        setLastResponse({
          game_code: res.gameCode,
          period_number: res.periodNumber,
          timestamp: res.timestamp,
          next_period_number: res.nextPeriodNumber,
          draw_interval_seconds: res.drawIntervalSeconds,
        });
        setLastStatus(200);
      }
      setResponseTime(Math.round(performance.now() - start));
      showToast(`${currentEndpoint.method} ${currentEndpoint.path} executed`, 'success');
    } catch (err: unknown) {
      setResponseTime(Math.round(performance.now() - start));
      setLastStatus(400);
      const errMsg = err instanceof Error ? err.message : 'Request failed';
      setLastResponse({ status: 'error', code: 400, message: errMsg });
      showToast(errMsg, 'error');
    } finally {
      setIsRunning(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getMethodBadge = (m: HttpMethod) => {
    switch (m) {
      case 'GET':
        return 'bg-[#35B978]/15 text-[#35B978] border-[#35B978]/30';
      case 'POST':
        return 'bg-[#E7B93F]/15 text-[#E7B93F] border-[#E7B93F]/30';
      case 'DELETE':
        return 'bg-[#F04444]/15 text-[#F04444] border-[#F04444]/30';
      default:
        return 'bg-gray-800 text-gray-200 border-gray-700';
    }
  };

  return (
    <div className="space-y-6">
      {/* Server Status Header Bar */}
      <div className="p-5 rounded-2xl bg-[#071A14] border border-[#1E3A2B] flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-6 text-xs">
          <div>
            <span className="text-[#8D9B95] uppercase block text-[11px] font-semibold">
              Environment
            </span>
            <span className="font-mono font-bold text-[#E7B93F] px-2 py-0.5 rounded bg-[#06130F] border border-[#1E3A2B] inline-block mt-0.5">
              MOCK / TEST SANDBOX
            </span>
          </div>

          <div>
            <span className="text-[#8D9B95] uppercase block text-[11px] font-semibold">
              Host
            </span>
            <span className="font-mono font-medium text-[#F5F5F5] inline-block mt-0.5">
              http://localhost:3000
            </span>
          </div>

          <div>
            <span className="text-[#8D9B95] uppercase block text-[11px] font-semibold">
              Specification
            </span>
            <span className="inline-flex items-center gap-1.5 font-semibold text-[#35B978] mt-0.5">
              <span className="w-2 h-2 rounded-full bg-[#35B978] animate-pulse" />
              SaaS Imperial REST v1.0
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-[#8D9B95] bg-[#06130F] px-3 py-1.5 rounded-lg border border-[#1E3A2B]">
          <Server className="w-4 h-4 text-[#35B978]" />
          <span>Local Simulation Active</span>
        </div>
      </div>

      {/* Main Console Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Endpoints selector & documentation */}
        <div className="lg:col-span-5 space-y-3">
          <h3 className="text-xs font-bold text-[#8D9B95] uppercase tracking-wider px-1">
            SaaS Imperial Documented Endpoints
          </h3>
          <div className="space-y-2">
            {ENDPOINTS.map((ep) => {
              const isSelected = selectedEndpointId === ep.id;
              return (
                <button
                  key={ep.id}
                  type="button"
                  onClick={() => handleSelectEndpoint(ep)}
                  className={`w-full text-left p-3.5 rounded-xl border transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-[#0E2E22] border-[#E7B93F] shadow-[0_0_12px_rgba(231,185,63,0.15)] ring-1 ring-[#E7B93F]/50'
                      : 'bg-[#071A14] border-[#1E3A2B] hover:border-[#2b543e] hover:bg-[#0b241c]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border uppercase ${getMethodBadge(
                        ep.method
                      )}`}
                    >
                      {ep.method}
                    </span>
                    <span className="text-xs text-[#E7B93F] font-semibold truncate">{ep.name}</span>
                  </div>
                  <div className="font-mono text-xs text-[#F5F5F5] font-semibold mt-2 truncate">
                    {ep.path}
                  </div>
                  <p className="text-[11px] text-[#8D9B95] mt-1 line-clamp-2">
                    {ep.description}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right Column: Runner & Response Explorer */}
        <div className="lg:col-span-7 bg-[#071A14] border border-[#1E3A2B] rounded-2xl p-6 shadow-xl space-y-5">
          {/* Header */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-[#1E3A2B]">
            <div className="flex items-center gap-3">
              <span
                className={`text-xs font-mono font-bold px-2.5 py-1 rounded border uppercase ${getMethodBadge(
                  currentEndpoint.method
                )}`}
              >
                {currentEndpoint.method}
              </span>
              <span className="font-mono text-xs sm:text-sm font-bold text-[#F5F5F5] break-all">
                {currentEndpoint.path}
              </span>
            </div>

            <button
              type="button"
              disabled={isRunning}
              onClick={handleRunRequest}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#E7B93F] hover:bg-[#f3c754] text-[#020806] font-bold text-xs shadow-md transition-colors cursor-pointer disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              {isRunning ? 'Executing...' : 'Run Test Request'}
            </button>
          </div>

          {/* Parameters / Body Editor */}
          {currentEndpoint.method === 'POST' ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-[#8D9B95] uppercase tracking-wider">
                  Payload (JSON / form-urlencoded)
                </span>
                <span className="text-[#8D9B95] text-[11px]">Exact doc parameters</span>
              </div>
              <textarea
                rows={6}
                value={requestBodyText}
                onChange={(e) => setRequestBodyText(e.target.value)}
                className="w-full bg-[#06130F] border border-[#1E3A2B] rounded-xl p-3 text-xs font-mono text-[#F5F5F5] focus:outline-none focus:border-[#E7B93F]"
              />
            </div>
          ) : (
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-[#8D9B95] uppercase tracking-wider">
                Query Parameter (game)
              </label>
              <input
                type="text"
                value={paramInput}
                onChange={(e) => setParamInput(e.target.value)}
                placeholder="WinGo_30S"
                className="w-full bg-[#06130F] border border-[#1E3A2B] rounded-xl px-4 py-2 text-xs font-mono text-[#F5F5F5] focus:outline-none focus:border-[#E7B93F]"
              />
            </div>
          )}

          {/* Response Viewer */}
          <div className="space-y-2 pt-2">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <Terminal className="w-3.5 h-3.5 text-[#E7B93F]" />
                <span className="font-semibold text-[#8D9B95] uppercase tracking-wider">
                  Response Output
                </span>
                {lastStatus && (
                  <span
                    className={`font-mono text-[11px] font-bold px-1.5 py-0.2 rounded border ${
                      lastStatus < 300
                        ? 'bg-[#35B978]/15 text-[#35B978] border-[#35B978]/30'
                        : 'bg-[#F04444]/15 text-[#F04444] border-[#F04444]/30'
                    }`}
                  >
                    HTTP {lastStatus}
                  </span>
                )}
                {responseTime !== null && (
                  <span className="text-[#8D9B95] font-mono text-[11px]">
                    ({responseTime}ms)
                  </span>
                )}
              </div>

              {lastResponse !== null && (
                <button
                  type="button"
                  onClick={() => copyToClipboard(JSON.stringify(lastResponse, null, 2))}
                  className="inline-flex items-center gap-1 text-[#8D9B95] hover:text-[#F5F5F5] transition-colors cursor-pointer"
                >
                  {copied ? <Check className="w-3 h-3 text-[#35B978]" /> : <Copy className="w-3 h-3" />}
                  <span>{copied ? 'Copied' : 'Copy JSON'}</span>
                </button>
              )}
            </div>

            <div className="p-4 rounded-xl bg-[#06130F] border border-[#1E3A2B] min-h-[170px] max-h-[340px] overflow-auto font-mono text-xs text-[#F5F5F5]">
              {lastResponse !== null ? (
                <pre className="text-emerald-400">
                  {String(JSON.stringify(lastResponse, null, 2))}
                </pre>
              ) : (
                <div className="text-[#8D9B95] py-12 text-center">
                  <p>Click "Run Test Request" to simulate this endpoint against the test server.</p>
                  <p className="text-[11px] text-[#5e6f66] mt-1">
                    All transactions are recorded in real-time under API Logs.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
