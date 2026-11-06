FROM mcr.microsoft.com/playwright/python:v1.64.0-noble@sha256:684df257a1fa0ef3fa288239819984008f560e8f8db5b635ee9e2a50cbcd2e23
RUN pip install --no-cache-dir playwright==1.64.0
WORKDIR /worker
COPY worker.py extract.js ./
USER pwuser
ENTRYPOINT ["python", "-u", "/worker/worker.py"]
