<?php

$configPath = __DIR__ . '/config.php';
if (!file_exists($configPath)) {
    http_response_code(500);
    echo 'Missing config.php';
    exit;
}

$config = require $configPath;
$rawBody = file_get_contents('php://input');

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    verify_webhook($config);
}

if ($_SERVER['REQUEST_METHOD'] === 'HEAD') {
    http_response_code(200);
    header('Content-Type: text/plain');
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!is_valid_whatsapp_signature($rawBody, $config)) {
        json_response(['error' => 'Invalid signature'], 403);
    }

    $payload = json_decode($rawBody, true) ?: [];
    json_response(['received' => true]);
    finish_request();

    try {
        handle_webhook($payload, $config);
    } catch (Throwable $exception) {
        error_log('Webhook processing failed: ' . $exception->getMessage());
    }

    exit;
}

json_response(['error' => 'Not found'], 404);

function verify_webhook(array $config): void
{
    $mode = $_GET['hub_mode'] ?? $_GET['hub.mode'] ?? '';
    $token = $_GET['hub_verify_token'] ?? $_GET['hub.verify_token'] ?? '';
    $challenge = $_GET['hub_challenge'] ?? $_GET['hub.challenge'] ?? '';

    if ($mode === 'subscribe' && $token === $config['whatsapp_verify_token'] && $challenge !== '') {
        http_response_code(200);
        header('Content-Type: text/plain');
        echo $challenge;
        exit;
    }

    json_response(['error' => 'Webhook verification failed'], 403);
}

function handle_webhook(array $payload, array $config): void
{
    foreach (($payload['entry'] ?? []) as $entry) {
        foreach (($entry['changes'] ?? []) as $change) {
            foreach (($change['value']['messages'] ?? []) as $message) {
                $from = $message['from'] ?? '';
                if ($from === '') {
                    continue;
                }

                if (!should_process_message($message)) {
                    continue;
                }

                if (!empty($config['allowed_test_numbers']) && !in_array($from, $config['allowed_test_numbers'], true)) {
                    continue;
                }

                $text = get_message_text($message);
                if ($text === '') {
                    send_whatsapp_text($from, 'Thank you for contacting Hominal Healthcare. Please send your request in text and our assistant will help.', $config);
                    continue;
                }

                $reply = generate_ai_reply($text, $config);
                try {
                    send_whatsapp_text($from, $reply, $config);
                } catch (Throwable $exception) {
                    error_log('Failed to send WhatsApp reply: ' . $exception->getMessage());
                }
            }
        }
    }
}

function get_message_text(array $message): string
{
    $type = $message['type'] ?? '';

    if ($type === 'text') {
        return trim($message['text']['body'] ?? '');
    }

    if ($type === 'button') {
        return trim($message['button']['text'] ?? '');
    }

    if ($type === 'interactive') {
        return trim(
            $message['interactive']['button_reply']['title']
            ?? $message['interactive']['list_reply']['title']
            ?? ''
        );
    }

    return '';
}

function generate_ai_reply(string $userText, array $config): string
{
    if (empty($config['openai_api_key']) || str_starts_with($config['openai_api_key'], 'sk-your-key')) {
        return fallback_reply($userText);
    }

    $systemPrompt = "You are Hominal Healthcare Pvt Ltd's WhatsApp assistant.\n"
        . "You help patients and families with polite, concise answers about home healthcare services.\n"
        . "Typical requests include nursing care, attendant care, doctor visits, physiotherapy, elder care, patient billing support, service availability, and callbacks.\n"
        . "Ask for city/locality, patient condition, service needed, preferred date/time, and contact name when booking or callback is needed.\n"
        . "Do not diagnose, prescribe medicine, or replace emergency care. For emergencies, tell the user to call local emergency services or visit the nearest hospital immediately.\n"
        . "Keep replies short enough for WhatsApp.";

    try {
        $response = http_json('https://api.openai.com/v1/responses', [
            'model' => $config['openai_model'],
            'input' => [
                ['role' => 'system', 'content' => $systemPrompt],
                ['role' => 'user', 'content' => $userText],
            ],
            'max_output_tokens' => 220,
        ], [
            'Authorization: Bearer ' . $config['openai_api_key'],
            'Content-Type: application/json',
        ]);

        return trim($response['output_text'] ?? '')
            ?: 'Thank you for contacting Hominal Healthcare. Please share the service needed, city, patient condition, and preferred callback time.';
    } catch (Throwable $exception) {
        error_log('Falling back after OpenAI error: ' . $exception->getMessage());
        return fallback_reply($userText);
    }
}

function fallback_reply(string $userText): string
{
    $text = strtolower($userText);

    if (str_contains($text, 'emergency') || str_contains($text, 'urgent')) {
        return 'If this is a medical emergency, please call local emergency services or visit the nearest hospital immediately. For Hominal Healthcare home care support, please share your city, patient condition, and contact name.';
    }

    if (str_contains($text, 'price') || str_contains($text, 'cost') || str_contains($text, 'charges')) {
        return 'Hominal Healthcare can confirm pricing after checking the service needed, duration, location, and patient condition. Please share your city, service requirement, and preferred callback time.';
    }

    return 'Thank you for contacting Hominal Healthcare Pvt Ltd. Please share the service needed, city/locality, patient condition, and preferred callback time. Our team will assist you shortly.';
}

function send_whatsapp_text(string $to, string $body, array $config): void
{
    $url = 'https://graph.facebook.com/'
        . rawurlencode($config['whatsapp_api_version'])
        . '/'
        . rawurlencode($config['whatsapp_phone_number_id'])
        . '/messages';

    http_json($url, [
        'messaging_product' => 'whatsapp',
        'recipient_type' => 'individual',
        'to' => $to,
        'type' => 'text',
        'text' => [
            'preview_url' => false,
            'body' => $body,
        ],
    ], [
        'Authorization: Bearer ' . $config['whatsapp_access_token'],
        'Content-Type: application/json',
    ]);
}

function http_json(string $url, array $payload, array $headers): array
{
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_POSTFIELDS => json_encode($payload),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 25,
    ]);

    $body = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);
    curl_close($ch);

    if ($body === false || $status < 200 || $status >= 300) {
        throw new RuntimeException('HTTP request failed: ' . $status . ' ' . $error . ' ' . $body);
    }

    return json_decode($body, true) ?: [];
}

function is_valid_whatsapp_signature(string $rawBody, array $config): bool
{
    $appSecret = $config['whatsapp_app_secret'] ?? '';
    if ($appSecret === '') {
        return true;
    }

    $signatureHeader = $_SERVER['HTTP_X_HUB_SIGNATURE_256'] ?? '';
    if (!str_starts_with($signatureHeader, 'sha256=')) {
        return false;
    }

    $receivedSignature = substr($signatureHeader, 7);
    $expectedSignature = hash_hmac('sha256', $rawBody, $appSecret);

    return hash_equals($expectedSignature, $receivedSignature);
}

function should_process_message(array $message): bool
{
    $messageId = $message['id'] ?? '';
    $from = $message['from'] ?? '';
    if ($messageId === '' || $from === '') {
        return false;
    }

    $cacheDir = sys_get_temp_dir() . '/hominal-whatsapp-dedupe';
    if (!is_dir($cacheDir) && !mkdir($cacheDir, 0775, true) && !is_dir($cacheDir)) {
        return true;
    }

    prune_message_cache($cacheDir);
    $cacheFile = $cacheDir . '/' . preg_replace('/[^a-zA-Z0-9_-]/', '_', $messageId);
    if (file_exists($cacheFile)) {
        error_log('Skipping duplicate message ' . $messageId);
        return false;
    }

    @file_put_contents($cacheFile, (string) time());
    return true;
}

function prune_message_cache(string $cacheDir): void
{
    $cutoff = time() - 600;
    foreach (glob($cacheDir . '/*') ?: [] as $filePath) {
        if (@filemtime($filePath) !== false && filemtime($filePath) < $cutoff) {
            @unlink($filePath);
        }
    }
}

function finish_request(): void
{
    if (function_exists('fastcgi_finish_request')) {
        fastcgi_finish_request();
        return;
    }

    @ob_flush();
    flush();
}

function json_response(array $body, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json');
    echo json_encode($body);
    exit;
}
