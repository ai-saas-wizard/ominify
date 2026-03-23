import Link from "next/link";
import { ArrowLeft, Mail, CheckCircle } from "lucide-react";
import { EmailConfigForm } from "@/components/settings/email-config-form";
import {
    getEmailConfig,
    saveEmailConfig,
    testEmailConnection,
    deleteEmailConfig,
} from "@/app/actions/email-config-actions";
import { PageTransition } from "@/components/ui/page-transition";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import {
    Table,
    TableHeader,
    TableBody,
    TableHead,
    TableRow,
    TableCell,
} from "@/components/ui/table";

export default async function EmailSettingsPage(props: {
    params: Promise<{ clientId: string }>;
}) {
    const params = await props.params;
    const clientId = params.clientId;

    const config = await getEmailConfig(clientId);

    return (
        <PageTransition>
            <div className="p-4 lg:p-8 max-w-4xl mx-auto space-y-8">
                {/* Header */}
                <div>
                    <Link
                        href={`/client/${clientId}/settings`}
                        className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-4"
                    >
                        <ArrowLeft className="w-4 h-4 mr-2" />
                        Back to Settings
                    </Link>
                    <h1 className="text-3xl font-bold text-gray-900">Email Configuration</h1>
                    <p className="mt-1 text-gray-600">
                        Configure your SMTP email settings for sequence emails
                    </p>
                </div>

                {/* Status Banner */}
                {config?.is_verified ? (
                    <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center gap-3">
                        <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
                        <div>
                            <p className="text-green-800 font-medium">Email is configured and verified</p>
                            <p className="text-green-700 text-sm">
                                Sending from {config.from_name ? `${config.from_name} <${config.from_email}>` : config.from_email}
                            </p>
                        </div>
                    </div>
                ) : config ? (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-center gap-3">
                        <Mail className="w-5 h-5 text-amber-600 flex-shrink-0" />
                        <div>
                            <p className="text-amber-800 font-medium">Email configured but not verified</p>
                            <p className="text-amber-700 text-sm">
                                Use the &quot;Test Connection&quot; button below to verify your SMTP settings
                            </p>
                        </div>
                    </div>
                ) : (
                    <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 flex items-center gap-3">
                        <Mail className="w-5 h-5 text-gray-500 flex-shrink-0" />
                        <div>
                            <p className="text-gray-800 font-medium">No email configured</p>
                            <p className="text-gray-600 text-sm">
                                Set up SMTP to enable email steps in your sequences
                            </p>
                        </div>
                    </div>
                )}

                {/* Email Config Form */}
                <Card className="overflow-hidden">
                    <CardHeader className="border-b border-gray-200 bg-gray-50 flex-row items-center gap-3 space-y-0 px-6 py-4">
                        <Mail className="w-5 h-5 text-gray-600" />
                        <h2 className="text-lg font-semibold text-gray-900">SMTP Settings</h2>
                    </CardHeader>
                    <CardContent className="pt-6">
                        <EmailConfigForm
                            clientId={clientId}
                            config={config}
                            saveAction={saveEmailConfig}
                            testAction={testEmailConnection}
                            deleteAction={deleteEmailConfig}
                        />
                    </CardContent>
                </Card>

                {/* Help Section */}
                <Card className="overflow-hidden">
                    <CardHeader className="border-b border-gray-200 bg-gray-50 px-6 py-4">
                        <h2 className="text-lg font-semibold text-gray-900">
                            Common SMTP Settings
                        </h2>
                    </CardHeader>
                    <CardContent className="pt-6">
                        <Table>
                            <TableHeader>
                                <TableRow className="text-left text-gray-500 border-b border-gray-100">
                                    <TableHead className="font-medium">Provider</TableHead>
                                    <TableHead className="font-medium">SMTP Host</TableHead>
                                    <TableHead className="font-medium">Port</TableHead>
                                    <TableHead className="font-medium">Notes</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody className="text-gray-700">
                                <TableRow className="border-b border-gray-50">
                                    <TableCell className="font-medium">Gmail</TableCell>
                                    <TableCell className="font-mono text-xs">smtp.gmail.com</TableCell>
                                    <TableCell>587</TableCell>
                                    <TableCell className="text-xs text-gray-500">Requires App Password (2FA enabled)</TableCell>
                                </TableRow>
                                <TableRow className="border-b border-gray-50">
                                    <TableCell className="font-medium">Outlook / 365</TableCell>
                                    <TableCell className="font-mono text-xs">smtp.office365.com</TableCell>
                                    <TableCell>587</TableCell>
                                    <TableCell className="text-xs text-gray-500">Use STARTTLS</TableCell>
                                </TableRow>
                                <TableRow className="border-b border-gray-50">
                                    <TableCell className="font-medium">SendGrid</TableCell>
                                    <TableCell className="font-mono text-xs">smtp.sendgrid.net</TableCell>
                                    <TableCell>587</TableCell>
                                    <TableCell className="text-xs text-gray-500">Username: apikey, Password: your API key</TableCell>
                                </TableRow>
                                <TableRow className="border-b border-gray-50">
                                    <TableCell className="font-medium">Mailgun</TableCell>
                                    <TableCell className="font-mono text-xs">smtp.mailgun.org</TableCell>
                                    <TableCell>587</TableCell>
                                    <TableCell className="text-xs text-gray-500">Use domain SMTP credentials</TableCell>
                                </TableRow>
                                <TableRow>
                                    <TableCell className="font-medium">AWS SES</TableCell>
                                    <TableCell className="font-mono text-xs">email-smtp.us-east-1.amazonaws.com</TableCell>
                                    <TableCell>587</TableCell>
                                    <TableCell className="text-xs text-gray-500">Use SMTP credentials (not IAM)</TableCell>
                                </TableRow>
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            </div>
        </PageTransition>
    );
}
