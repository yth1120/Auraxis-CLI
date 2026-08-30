import { useState } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import type { ReasoningEffort } from '@auraxis/core';
import { Panel, PromptBar, useTheme } from './blocks.js';

export function OnboardingWizard({
  models,
  defaultModel,
  onApiKey,
  onComplete,
}: {
  models: ReadonlyArray<{ id: string; name: string }>;
  defaultModel: string;
  onApiKey: (apiKey: string) => Promise<void>;
  onComplete: (model: string, reasoningEffort: ReasoningEffort) => Promise<void>;
}) {
  const theme = useTheme();
  const { stdout } = useStdout();
  const [stage, setStage] = useState<'api-key' | 'model' | 'effort'>('api-key');
  const [input, setInput] = useState('');
  const [modelIndex, setModelIndex] = useState(Math.max(0, models.findIndex((model) => model.id === defaultModel)));
  const [effortIndex, setEffortIndex] = useState(1);
  const [saving, setSaving] = useState(false);
  const columns = stdout.columns || 80;
  const width = Math.max(24, Math.min(72, columns - 4));
  const left = Math.max(0, Math.floor((columns - width) / 2));
  const efforts: ReasoningEffort[] = ['low', 'high', 'max'];

  useInput((keyInput, key) => {
    if (saving) return;
    if (key.escape && stage === 'api-key') {
      setInput('');
      return;
    }
    if (stage === 'api-key') {
      if (key.return) {
        const value = input.trim();
        if (!value) return;
        setSaving(true);
        void onApiKey(value)
          .then(() => {
            setInput('');
            setStage('model');
          })
          .finally(() => setSaving(false));
        return;
      }
      if (key.backspace) {
        setInput((current) => current.slice(0, -1));
      } else if (!key.ctrl && !key.meta && keyInput) {
        setInput((current) => current + keyInput);
      }
      return;
    }

    if (stage === 'model') {
      if (key.leftArrow) {
        setModelIndex((current) => (current - 1 + models.length) % models.length);
      } else if (key.rightArrow) {
        setModelIndex((current) => (current + 1) % models.length);
      } else if (key.return) {
        setStage('effort');
      }
      return;
    }

    if (key.leftArrow) {
      setEffortIndex((current) => (current - 1 + efforts.length) % efforts.length);
    } else if (key.rightArrow) {
      setEffortIndex((current) => (current + 1) % efforts.length);
    } else if (key.return) {
      setSaving(true);
      void onComplete(models[modelIndex].id, efforts[effortIndex]).finally(() => setSaving(false));
    }
  });

  return (
    <Box flexDirection="column" width={width} marginLeft={left}>
      <Panel border="double" title="Auraxis Agent · 首次配置" color={theme.brand} width={width}>
        {stage === 'api-key' ? (
          <Box flexDirection="column">
            <Text color={theme.text} bold>
              请输入 DeepSeek API Key
            </Text>
            <Text dimColor>密钥只保存在本地并使用机器密钥加密，后续可用 /api-key 更新。</Text>
            <Box marginTop={1}>
              <PromptBar
                input={input.replace(/[^\s]/g, '•')}
                running={false}
                bordered
                width={width - 2}
                placeholder="粘贴或输入 API Key…"
              />
            </Box>
            <Text dimColor>Enter 继续 · Esc 清空</Text>
          </Box>
        ) : null}

        {stage === 'model' ? (
          <Box flexDirection="column">
            <Text color={theme.text} bold>
              选择模型
            </Text>
            <Box flexDirection="column" marginTop={1}>
              {models.map((model, index) => (
                <Text key={model.id} color={index === modelIndex ? theme.highlight : theme.muted} bold={index === modelIndex}>
                  {index === modelIndex ? '▶' : ' '} {model.id} · {model.name}
                </Text>
              ))}
            </Box>
            <Text dimColor>← → 选择 · Enter 确认</Text>
          </Box>
        ) : null}

        {stage === 'effort' ? (
          <Box flexDirection="column">
            <Text color={theme.text} bold>
              选择思考深度
            </Text>
            <Box flexDirection="column" marginTop={1}>
              {efforts.map((effort, index) => (
                <Text key={effort} color={index === effortIndex ? theme.highlight : theme.muted} bold={index === effortIndex}>
                  {index === effortIndex ? '▶' : ' '} {effort}
                  {effort === 'low' ? ' · 快速' : effort === 'high' ? ' · 均衡（推荐）' : ' · 深入'}
                </Text>
              ))}
            </Box>
            <Text dimColor>← → 选择 · Enter 确认</Text>
          </Box>
        ) : null}
      </Panel>
    </Box>
  );
}
