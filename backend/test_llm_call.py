import requests

if __name__ == '__main__':
    url = 'http://localhost:8000/llm/weights'
    payload = {'prompt': 'I want a scenic, flat route and avoid highways'}
    r = requests.post(url, json=payload)
    print(r.status_code)
    print(r.json())
