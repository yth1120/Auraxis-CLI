import { Box, Text, render, useStdin, useStdout } from 'ink';
import { BUILT_IN_MODELS } from '@auraxis/core';
import type { CliOptions } from '../args.js';
import {
  HeaderBar,
  PathBar,
  StatusBar,
  PromptBar,
  UserBlock,
  AssistantBlock,
  ThinkingBlock,
  ToolBlock,
  PlanBlock,
  PermissionBlock,
  AskBlock,
  ErrorBlock,
  SystemBlock,
  ThemeProvider,
  CodeOutputBlock,
  CodeToolRow,
  HomeCard,
  ExecutionPanel,
  CommandHintsBar,
  HelpPanel,
  SkillsPanel,
  ModelPickerPanel,
  ChoicePickerPanel,
  ActiveCommandBar,
  PendingQueue,
  getTheme,
} from './blocks.js';
import type { TerminalController } from './terminal-model.js';
import { OnboardingWizard } from './wizard.js';
import { useTerminalController } from './terminal-controller.js';
import { CLI_VERSION } from '../version.js';

function App({ options }: { options: CliOptions }) {
  const { isRawModeSupported } = useStdin();
  const { stdout } = useStdout();
  const controller: TerminalController = useTerminalController({ options });
  const theme = getTheme(controller.theme);

  if (!isRawModeSupported) {
    return <Text color={theme.warning}>当前终端不支持交互模式，请运行 auraxis --run "任务"。</Text>;
  }

  if (controller.onboarding === null) {
    return (
      <ThemeProvider theme={controller.theme}>
        <Box paddingX={1}>
          <Text dimColor>正在检查配置…</Text>
        </Box>
      </ThemeProvider>
    );
  }

  if (controller.onboarding) {
    return (
      <ThemeProvider theme={controller.theme}>
        <Box paddingX={1}>
          <OnboardingWizard
            models={BUILT_IN_MODELS}
            defaultModel={controller.model}
            onApiKey={controller.saveOnboardingApiKey}
            onComplete={controller.completeOnboarding}
          />
        </Box>
      </ThemeProvider>
    );
  }

  const executionRows = controller.activity.length > 0 ? Math.min(controller.activity.length + 1, 9) : 0;
  const transcriptEntries =
    controller.activity.length > 0
      ? controller.entries.filter((item) => item.kind !== 'tool' && item.kind !== 'code_tool')
      : controller.entries;
  const homeRows = controller.showHome ? 9 : 0;
  const visibleWindow = Math.max(4, Math.min(30, (stdout.rows || 24) - 14 - homeRows - executionRows));
  const visibleEntries = transcriptEntries.slice(
    Math.max(0, transcriptEntries.length - visibleWindow - controller.scrollOffset),
    Math.max(0, transcriptEntries.length - controller.scrollOffset),
  );
  const currentTool = [...controller.activity].reverse().find((item) => item.status === 'running')?.name;
  const promptWidth = Math.max(20, (stdout.columns || 80) - 2);

  return (
    <ThemeProvider theme={controller.theme}>
      <Box flexDirection="column" paddingX={1}>
        <Box flexDirection="column" flexGrow={controller.showHome ? 0 : 1} marginBottom={controller.showHome ? 0 : 1}>
          {controller.showHome ? (
            <HomeCard
              version={CLI_VERSION}
              project={controller.projectFull}
              model={controller.model}
              permission={controller.mode}
              reasoningEffort={controller.thinkingEnabled ? controller.reasoningEffort : 'off'}
              homeFocus={controller.homeFocus}
              selectedCommand={controller.selectedCommand}
            />
          ) : (
            <HeaderBar project={controller.projectLabel} running={controller.running} />
          )}
          {controller.showHelp ? <HelpPanel /> : null}
          {transcriptEntries.length > 0 ? (
            <Box flexDirection="column" marginTop={1} marginBottom={1}>
              {visibleEntries.map((item: any, index: number) => {
                switch (item.kind) {
                  case 'user':
                    return <UserBlock key={index} text={item.text} />;
                  case 'assistant':
                    return <AssistantBlock key={index} text={item.text} />;
                  case 'thinking':
                    return <ThinkingBlock key={index} text={item.text} expanded={controller.expandedThinking} />;
                  case 'tool':
                    return (
                      <ToolBlock
                        key={index}
                        name={item.toolName || 'Tool'}
                        summary={item.text}
                        status={item.status}
                        ok={item.ok}
                        error={item.error}
                        duration={item.duration}
                        output={item.output}
                      />
                    );
                  case 'plan':
                    return <PlanBlock key={index} plan={item.plan || { tasks: [], summary: item.text }} />;
                  case 'code':
                    return <CodeOutputBlock key={index} lines={item.lines || []} running={item.codeRunning !== false} />;
                  case 'code_tool':
                    return (
                      <CodeToolRow
                        key={index}
                        name={item.toolName || 'Tool'}
                        status={item.status}
                        ok={item.ok}
                        error={item.error}
                        duration={item.duration}
                      />
                    );
                  case 'error':
                    return <ErrorBlock key={index} text={item.text} />;
                  case 'system':
                    return <SystemBlock key={index} text={item.text} />;
                  default:
                    return null;
                }
              })}
            </Box>
          ) : null}
          {controller.skillsPanel ? (
            <SkillsPanel
              skills={controller.skillsPanel}
              selected={controller.selectedSkill}
              detail={controller.skillsDetail}
              detailContent={controller.skillsDetailContent}
            />
          ) : null}
          {controller.modelPicker ? (
            <ModelPickerPanel
              models={controller.modelPicker.models}
              selected={controller.modelPicker.selected}
              source={controller.modelPicker.source}
            />
          ) : null}
          {controller.choicePicker ? <ChoicePickerPanel picker={controller.choicePicker} /> : null}
          {controller.prompt?.kind === 'permission' ? <PermissionBlock request={controller.prompt.request} /> : null}
          {controller.prompt?.kind === 'plan' ? (
            <>
              <PlanBlock plan={controller.prompt.plan} />
              <Text color={theme.plan}>[a]批准全部 · [r]拒绝 · [e]编辑计划</Text>
            </>
          ) : null}
          {controller.prompt?.kind === 'ask' ? <AskBlock question={controller.prompt.question} /> : null}
          {controller.exitArmed ? <Text color={theme.warning}>按 Ctrl+C 确认退出</Text> : null}
        </Box>
        <Box flexDirection="column" marginTop={1}>
          {controller.activity.length > 0 ? (
            <ExecutionPanel
              items={controller.activity}
              running={controller.running}
              expanded={controller.expandedActivity}
            />
          ) : null}
          <PendingQueue items={controller.pendingPrompts} />
          {controller.activeCommand ? <ActiveCommandBar command={controller.activeCommand} /> : null}
          {controller.commandSuggestions.length > 0 ? (
            <CommandHintsBar
              suggestions={controller.commandSuggestions}
              selected={controller.suggestionIndex}
              width={promptWidth}
            />
          ) : null}
          <PathBar project={controller.projectFull} />
          <Box width={promptWidth}>
            <PromptBar
              input={controller.input}
              running={controller.running}
              bordered={true}
              width={promptWidth}
              placeholder={controller.activeCommand?.placeholder}
            />
          </Box>
          <StatusBar
            model={controller.model}
            permission={controller.mode}
            reasoningEffort={controller.thinkingEnabled ? controller.reasoningEffort : 'off'}
            running={controller.running}
            currentTool={currentTool}
          />
        </Box>
      </Box>
    </ThemeProvider>
  );
}

export async function runInteractive(options: CliOptions): Promise<number> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error('交互模式需要 TTY。请直接在终端运行 auraxis，或使用 --run 执行任务。');
    return 1;
  }
  if (options.noColor) {
    process.env.NO_COLOR = '1';
    process.env.FORCE_COLOR = '0';
  }
  const app = render(<App options={options} />);
  await app.waitUntilExit();
  return 0;
}
