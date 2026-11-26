// The demo household as the front page's hero shows it: the accounts the seed
// creates (demo/generate-seed.mjs), their classes (demo/generate-metadata.cjs)
// and their balances on the day the seed was generated (26 Nov 2026). Answers are
// read from the same household in Bench. When the seed changes, update these
// from the demo so the hero and "Try the live demo" tell the same story.

import type { PictureAccount, PictureAnswer } from './WholePicture.astro';

export const pictureAccounts: PictureAccount[] = [
	{ name: 'Household Checking', balance: 34264.91, onBudget: true, cls: 'bank' },
	{ name: 'High-Yield Savings', balance: 45738.60, onBudget: true, cls: 'savings' },
	{ name: 'Cash Wallet', balance: 1025.90, onBudget: true, cls: 'cash' },
	{ name: 'Everyday Rewards Card', balance: -3300.51, onBudget: true, cls: 'credit-card' },
	{ name: 'Everyday Installments Card', balance: -100.00, onBudget: true, cls: 'credit-card' },
	{ name: 'Brokerage', balance: 116646.06, onBudget: false, cls: 'investment', note: 'available now' },
	{ name: 'Retirement 401(k)', balance: 190410.16, onBudget: false, cls: 'retirement', note: 'locked' },
	{ name: 'Family Home', balance: 444500.00, onBudget: false, cls: 'property' },
	{ name: 'Investment Property', balance: 253800.00, onBudget: false, cls: 'property' },
	{ name: 'Family Car', balance: 25146.60, onBudget: false, cls: 'vehicle' },
	{ name: 'Home Mortgage', balance: -259983.19, onBudget: false, cls: 'loan' },
	{ name: 'Investment Property Loan', balance: -143360.21, onBudget: false, cls: 'loan' },
	{ name: 'Car Loan', balance: -14829.04, onBudget: false, cls: 'loan' },
	{ name: 'Personal Loan', balance: -7618.41, onBudget: false, cls: 'loan' },
];

export const pictureAnswers = (docs: (path: string) => string): PictureAnswer[] => [
	{
		value: 'Jul 2044',
		label: 'The month the mortgage is paid off. Two extra payments already took three months off it.',
		feature: 'Loans',
		href: docs('user-guide/assets-debt/'),
	},
	{
		value: '41.5%',
		label: 'Of the family home that is theirs: 184,517 of equity.',
		feature: 'Assets',
		href: docs('user-guide/asset-registry/'),
	},
	{
		value: '9.2 months',
		label: 'How long their cash would last, after every bill and loan repayment.',
		feature: 'Financial Insights',
		href: docs('user-guide/financial-insights/'),
	},
];
