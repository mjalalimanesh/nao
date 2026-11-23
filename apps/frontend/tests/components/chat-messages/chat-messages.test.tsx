// @vitest-environment jsdom

import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestQueryClient } from '../../helpers/query-client';

import type { UIMessage } from '@nao/backend/chat';
import type * as ChatErrorModule from '@/components/chat-messages/chat-error';
import { ChatMessagesContent } from '@/components/chat-messages/chat-messages';

const mocks = vi.hoisted(() => {
	const question: UIMessage = {
		id: 'user-message',
		role: 'user',
		parts: [{ type: 'text', text: 'How did revenue do?' }],
	};
	const streamingAnswer: UIMessage = {
		id: 'assistant-message',
		role: 'assistant',
		parts: [{ type: 'text', text: 'Revenue grew', state: 'streaming' }],
	};
	return {
		agent: { isRunning: false, isCatchingUp: false, error: undefined as Error | undefined },
		question,
		streamingAnswer,
		messages: [question],
	};
});

vi.mock('@/contexts/agent.provider', () => ({
	useAgentContext: () => mocks.agent,
	useAgentMessages: () => mocks.messages,
}));
vi.mock('@/main', () => ({
	trpc: { chat: { getForkMetadata: { queryOptions: () => ({ queryKey: ['fork'], queryFn: async () => null }) } } },
}));
vi.mock('@/queries/use-chat-query', () => ({ useChatQuery: () => ({ data: false }) }));
vi.mock('@/hooks/use-chat-id', () => ({ useChatId: () => 'chat-1' }));
vi.mock('@/hooks/use-tool-call-density', () => ({ useToolCallDensity: () => ['compact'] }));
vi.mock('@/hooks/use-scroll-to-bottom-on-new-user-message', () => ({ useScrollToBottomOnNewUserMessage: () => {} }));
vi.mock('@/components/chat-messages/user-message', () => ({ UserMessage: () => <p>Question</p> }));
vi.mock('@/components/chat-messages/chat-error', async (importOriginal) => ({
	...(await importOriginal<typeof ChatErrorModule>()),
	ChatError: () => (mocks.agent.error ? <p>{mocks.agent.error.message}</p> : null),
}));
vi.mock('@/components/chat-messages/assistant-message-actions', () => ({ AssistantMessageActions: () => null }));
vi.mock('@/components/chat-messages/citation-text', () => ({
	AssistantTextWithCitation: ({ text }: { text: string }) => <p>{text}</p>,
}));
vi.mock('@/components/ui/conversation', () => ({ ConversationEmptyState: () => null }));

afterEach(() => {
	cleanup();
	mocks.agent = { isRunning: false, isCatchingUp: false, error: undefined };
	mocks.messages = [mocks.question];
});

describe('ChatMessagesContent', () => {
	it('shows a discreet loader while the chat catches up on a running answer', async () => {
		mocks.agent.isCatchingUp = true;

		renderMessages();

		expect(await screen.findByText('Catching up on the answer…')).toBeTruthy();
	});

	it('shows no catch-up loader once the chat caught up', async () => {
		renderMessages();

		await screen.findByText('Question');
		await new Promise((resolve) => setTimeout(resolve, 200));
		expect(screen.queryByText('Catching up on the answer…')).toBeNull();
	});

	it('keeps the thinking loader under an answer that is still streaming', async () => {
		mocks.agent.isRunning = true;
		mocks.messages = [mocks.question, mocks.streamingAnswer];

		renderMessages();

		await screen.findByText('Revenue grew');
		expect(screen.getByText(/^(Crunching|Analyzing|Thinking)$/)).toBeTruthy();
	});

	it('removes the thinking loader once the answer is complete', async () => {
		mocks.messages = [mocks.question, mocks.streamingAnswer];

		renderMessages();

		await screen.findByText('Revenue grew');
		expect(screen.queryByText(/^(Crunching|Analyzing|Thinking)$/)).toBeNull();
	});

	it.each([false, true])('shows a saved failure once whether or not the live error is present (%s)', (live) => {
		const errorMessage = 'The model provider failed.';
		mocks.agent.error = live ? new Error(errorMessage) : undefined;
		mocks.messages = [
			mocks.question,
			{
				id: 'earlier-failure',
				role: 'assistant',
				parts: [],
				stopReason: 'error',
				errorMessage: 'Earlier failure.',
			},
			{ ...mocks.streamingAnswer, stopReason: 'error', errorMessage },
		];

		renderMessages();

		expect(screen.getAllByText('Earlier failure.')).toHaveLength(1);
		expect(screen.getAllByText(errorMessage)).toHaveLength(1);
		expect(screen.getByText('Revenue grew')).toBeTruthy();
	});
});

function renderMessages() {
	return render(
		<QueryClientProvider client={createTestQueryClient()}>
			<ChatMessagesContent />
		</QueryClientProvider>,
	);
}
