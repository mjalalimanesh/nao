import { AlertCircleIcon, CheckIcon, CopyIcon, CreditCardIcon, RotateCcwIcon } from 'lucide-react';
import { Button } from '../ui/button';
import { Callout } from '../ui/callout';
import type { UIMessage } from '@nao/backend/chat';
import type { ReactNode } from 'react';
import { useAgentContext, useAgentMessagesSelector } from '@/contexts/agent.provider';
import { useCloudBillingAccess } from '@/hooks/use-cloud-billing-access';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { useOpenOrganizationBilling } from '@/hooks/use-open-organization-billing';
import {
	getLastUserMessageIdx,
	isOnboardingCompleteError,
	parseBudgetError,
	parseChatAllowanceExhaustedError,
	parseManagedCreditsError,
} from '@/lib/ai';
import { isCloudBillingAccessError } from '@/lib/cloud-billing-access';
import { cn } from '@/lib/utils';

export interface Props {
	className?: string;
}

type ParsedError = {
	error?: string;
	message?: string;
	requestId?: string;
};

function parseError(message: string): ParsedError {
	try {
		const parsed = JSON.parse(message);
		const nested = parsed?.error;
		if (nested && typeof nested === 'object') {
			return {
				error: asString(nested.code) ?? asString(nested.type),
				message: asString(nested.message) ?? asString(parsed.message) ?? message,
				requestId: asString(nested.requestId),
			};
		}
		return {
			error: asString(nested),
			message: asString(parsed?.message),
		};
	} catch {
		return { message };
	}
}

function asString(value: unknown): string | undefined {
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function ChatError({ className }: Props) {
	const { error, isRunning, resendMessage, clearError } = useAgentContext();
	const lastUserMessageId = useAgentMessagesSelector(findLastUserMessageId);
	const openOrganizationBilling = useOpenOrganizationBilling();
	const parsed = error ? parseError(error.message) : {};
	const isBillingAccessError = isCloudBillingAccessError(parsed);
	const billingAccess = useCloudBillingAccess({ enabled: isBillingAccessError });

	if (
		!error ||
		parseBudgetError(error) ||
		parseManagedCreditsError(error) ||
		parseChatAllowanceExhaustedError(error) ||
		isOnboardingCompleteError(error)
	) {
		return null;
	}

	const retry = async () => {
		if (!lastUserMessageId) {
			return;
		}

		clearError();
		await resendMessage({ messageId: lastUserMessageId });
	};

	if (isBillingAccessError) {
		return (
			<BillingAccessError
				access={billingAccess.data}
				className={className}
				isRunning={isRunning}
				isAccessPending={billingAccess.isPending}
				isAccessError={billingAccess.isError}
				isAccessFetching={billingAccess.isFetching}
				canRetry={Boolean(lastUserMessageId)}
				onManageBilling={(organizationId) => void openOrganizationBilling(organizationId)}
				onRetryAccess={() => void billingAccess.refetch()}
				onRetry={() => void retry()}
			/>
		);
	}

	return (
		<ChatErrorDetails details={parsed} className={className}>
			{lastUserMessageId && (
				<Button
					variant='outline'
					size='sm'
					className='mt-2'
					disabled={isRunning}
					onClick={() => {
						void retry();
					}}
				>
					<RotateCcwIcon />
					Retry
				</Button>
			)}
		</ChatErrorDetails>
	);
}

export function SavedChatError({ message }: { message: string }) {
	return <ChatErrorDetails details={parseError(message)} />;
}

function ChatErrorDetails({
	details: { error, message, requestId },
	className,
	children,
}: {
	details: ParsedError;
	className?: string;
	children?: ReactNode;
}) {
	const { isCopied, copy } = useCopyToClipboard();

	return (
		<div className={cn('flex items-start gap-2.5 px-4 py-3 text-red-500', className)}>
			<AlertCircleIcon className='size-4 shrink-0 mt-0.5' />

			<div className='flex flex-1 min-w-0 flex-col items-start gap-1 text-sm wrap-break-word'>
				{error && <span className='font-medium'>{error}</span>}
				{message && <p className='text-red-400 leading-relaxed'>{message}</p>}
				{requestId && (
					<div className='mt-2 flex items-center gap-1 text-xs text-muted-foreground'>
						<span>Provider request ID:</span>
						<code className='min-w-0 max-w-64 truncate' title={requestId}>
							{requestId}
						</code>
						<Button
							variant='ghost'
							size='icon-sm'
							aria-label='Copy provider request ID'
							onClick={() => {
								void copy(requestId);
							}}
						>
							{isCopied ? <CheckIcon /> : <CopyIcon />}
						</Button>
					</div>
				)}
				{children}
			</div>
		</div>
	);
}

function BillingAccessError({
	access,
	className,
	isRunning,
	isAccessPending,
	isAccessError,
	isAccessFetching,
	canRetry,
	onManageBilling,
	onRetryAccess,
	onRetry,
}: {
	access:
		| {
				organizationId: string;
				canManageBilling: boolean;
				trialAvailable: boolean;
		  }
		| undefined;
	className?: string;
	isRunning: boolean;
	isAccessPending: boolean;
	isAccessError: boolean;
	isAccessFetching: boolean;
	canRetry: boolean;
	onManageBilling: (organizationId: string) => void;
	onRetryAccess: () => void;
	onRetry: () => void;
}) {
	return (
		<Callout icon={CreditCardIcon} className={cn('px-4 py-3 text-sm', className)} role='status'>
			<p className='font-medium text-foreground'>A subscription is needed to continue chatting.</p>
			<p className='mt-1 text-muted-foreground'>
				{isAccessPending
					? 'Loading billing details...'
					: isAccessError
						? 'Billing details could not be loaded.'
						: access?.trialAvailable
							? access.canManageBilling
								? 'Finish setting up your first project to start your free trial, then retry your message.'
								: 'Ask an organization admin to finish setting up the first project, then retry your message.'
							: 'Manage your subscription, then retry your message.'}
			</p>
			<div className='mt-3 flex flex-wrap gap-2'>
				{access?.canManageBilling && (
					<Button size='sm' onClick={() => onManageBilling(access.organizationId)}>
						Manage billing
					</Button>
				)}
				{isAccessError && (
					<Button size='sm' disabled={isAccessFetching} onClick={onRetryAccess}>
						<RotateCcwIcon />
						Retry billing details
					</Button>
				)}
				{canRetry && (
					<Button variant='secondary' size='sm' disabled={isRunning} onClick={onRetry}>
						<RotateCcwIcon />
						Retry
					</Button>
				)}
			</div>
			{access && !access.canManageBilling && (
				<p className='mt-2 text-xs text-muted-foreground'>Ask an organization admin to manage billing.</p>
			)}
		</Callout>
	);
}

function findLastUserMessageId(messages: UIMessage[]): string | undefined {
	const lastUserMessageIndex = getLastUserMessageIdx(messages);
	return lastUserMessageIndex !== undefined ? messages[lastUserMessageIndex].id : undefined;
}
