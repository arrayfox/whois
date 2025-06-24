document.addEventListener('DOMContentLoaded', () => {
    // API_KEY is now expected to be globally available from config.js
    let apiKey; // Renamed from API_KEY to avoid confusion if user forgets to remove old const
    if (typeof CONFIG_API_KEY !== 'undefined') {
        apiKey = CONFIG_API_KEY;
    } else {
        apiKey = ''; // Set to empty if not found
        console.error("CONFIG_API_KEY is not defined. Ensure config.js is loaded before script.js and defines it.");
    }

    const whoisForm = document.getElementById('whoisForm');
    const domainInput = document.getElementById('domainInput');
    const resultsContainer = document.getElementById('resultsContainer');
    const errorContainer = document.getElementById('errorContainer');
    const loadingIndicator = document.getElementById('loadingIndicator');
    const searchButton = document.getElementById('searchButton');

    if (!apiKey || apiKey === 'YOUR_WHOISJSON_API_KEY_HERE' || apiKey === '') {
        const errorMsg = "API Key not configured. Please add your valid API key to config.js.";
        console.error(errorMsg); 
        displayError(errorMsg, true);
        if (whoisForm) {
            domainInput.disabled = true;
            searchButton.disabled = true;
        }
        resultsContainer.classList.remove('visible');
    }

    function isPotentialDomainForPath(text) {
        if (!text || typeof text !== 'string') return false;
        const looksLikeFilePath = text.includes(':/') || text.includes(':\\') || text.includes('%3A%2F%2F');
        const hasDot = text.includes('.');
        const isNotCommonWebFile = !/\.(html|htm|js|css)$/i.test(text); 

        if (looksLikeFilePath || !hasDot || !isNotCommonWebFile) return false;
        return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(text);
    }

    async function fetchWhoisData(domain) {
        if (!domain || domain.trim() === '') {
            displayError("Please enter a domain name.");
            return;
        }

        if (!apiKey || apiKey === 'YOUR_WHOISJSON_API_KEY_HERE' || apiKey === '') { // Check apiKey from config
             displayError("API Key not configured in config.js. Please update the CONFIG_API_KEY constant.", true);
             return;
        }
        
        showLoading(true);
        clearResults();
        clearError();
        
        const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9](?:\.[a-zA-Z]{2,})+$/;
        if (!domainRegex.test(domain)) {
            displayError(`"${domain}" is not a valid domain format. Ensure it includes a TLD (e.g., .com, .org) and no path or protocol.`);
            showLoading(false);
            return;
        }
        
        let responseText; 
        try {
            const response = await fetch(`https://whoisjson.com/api/v1/whois?domain=${encodeURIComponent(domain)}`, {
                method: 'GET',
                headers: {
                    'Authorization': `TOKEN=${apiKey}` // Use apiKey from config
                }
            });
            
            responseText = await response.clone().text(); 

            if (!response.ok) { 
                let errorMsg = `API Error (HTTP ${response.status}): ${response.statusText}.`;
                let isInfo = false;

                switch (response.status) {
                    case 400: errorMsg = `The domain name "${domain}" appears to be malformed or the request was invalid.`; break;
                    case 401: errorMsg = "API Key is invalid or not authorized. Please check your key in config.js."; break;
                    case 403: errorMsg = "Access denied by API. This could be due to API key permissions or your account status (e.g., email not validated). Check config.js."; break;
                    case 404: errorMsg = "WHOIS API endpoint not found. This might be a temporary issue or a problem with the service URL."; break;
                    case 429: errorMsg = "API rate limit reached. Please try again later."; break;
                    case 500: errorMsg = "An internal error occurred on the WHOIS server. Please try again later."; break;
                    case 502: case 503: case 504: errorMsg = "The WHOIS service is temporarily unavailable or experiencing issues. Please try again later."; break;
                }
                
                try {
                    const errorData = JSON.parse(responseText); 
                    if (errorData && errorData.message) {
                        if (!errorMsg.includes(errorData.message)) {
                             errorMsg += ` Message from API: ${errorData.message}`;
                        }
                    } else if (errorData && errorData.error && !errorMsg.includes(errorData.error)) {
                         errorMsg += ` Error from API: ${errorData.error}`;
                    }
                } catch (e) { /* Ignore if error body is not JSON */ }
                
                displayError(errorMsg, true, isInfo); 
                showLoading(false);
                return;
            }

            const data = JSON.parse(responseText); 

            if (data.error) { 
                displayError(`API Error in response: ${data.error}`);
            } else if (data.message && data.statusCode && data.statusCode !== 200) { 
                 displayError(`API Message (Code ${data.statusCode}): ${data.message}`, data.statusCode === 403 || data.statusCode === 401, true);
            }
            else if (Object.keys(data).length === 0 || !data.registered) { 
                 if (responseText.trim() === "{}" || responseText.trim() === "[]") {
                    displayError(`No WHOIS data found for "${domain}". The API returned an empty response.`, false, true);
                 } else {
                    displayError(`No WHOIS data found for "${domain}". The domain might be available for registration, or its WHOIS information could be private or restricted.`, false, true);
                 }
            }
            else {
                displayWhoisData(data); 
            }

        } catch (error) {
            console.error("Fetch function error:", error); 
            if (error instanceof SyntaxError && typeof responseText !== 'undefined' ) { 
                 displayError(`Error parsing API response. The server might have sent non-JSON data. Raw response: ${responseText ? responseText.substring(0, 200) : 'not available'}`, true);
            } else {
                displayError("An unexpected network or script error occurred. Please check your connection or try again.");
            }
        } finally {
            showLoading(false);
        }
    }

    function formatDate(dateString) {
        if (!dateString) return "N/A";
        try {
            const date = new Date(dateString.replace(' ', 'T')); 
            if (isNaN(date.getTime())) { 
                return dateString; 
            }
            return date.toLocaleDateString(undefined, { 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric',
            });
        } catch (e) {
            return dateString; 
        }
    }
    
    function createStatusBadge(statusText) {
        const badge = document.createElement('span');
        badge.className = 'status-badge';
        const lowerStatusText = statusText.toLowerCase();

        if (lowerStatusText.includes('ok') && !lowerStatusText.includes('hold')) { 
            badge.classList.add('status-ok');
        } else if (lowerStatusText.includes('prohibited') || lowerStatusText.includes('lock')) {
            badge.classList.add('status-prohibited');
        } else if (lowerStatusText.includes('pending')) { 
            badge.classList.add('status-pending');
        } else if (lowerStatusText.includes('redemption') || lowerStatusText.includes('grace') || lowerStatusText.includes('hold')) { 
            badge.classList.add('status-warning');
        }
        badge.textContent = statusText.replace(/https?:\/\/\S+/gi, '').trim(); 
        return badge;
    }

    function displayWhoisData(data) {
        resultsContainer.innerHTML = ''; 

        const keyDatesSection = document.createElement('div');
        keyDatesSection.className = 'result-section key-dates-section';
        const keyDatesTitle = document.createElement('h3');
        keyDatesTitle.textContent = "Key Dates";
        keyDatesSection.appendChild(keyDatesTitle);

        const keyDatesList = document.createElement('div');
        keyDatesList.className = 'key-dates-list';
        
        const datesToShow = [
            { label: "Registered On", value: formatDate(data.created) },
            { label: "Last Updated", value: formatDate(data.changed) },
            { label: "Expires On", value: formatDate(data.expires) }
        ];

        datesToShow.forEach(dateItem => {
            const dateDiv = document.createElement('div');
            dateDiv.className = 'key-date-item';
            
            const labelEl = document.createElement('span');
            labelEl.className = 'key-date-label';
            labelEl.textContent = dateItem.label;
            
            const valueEl = document.createElement('span');
            valueEl.className = 'key-date-value';
            valueEl.textContent = dateItem.value;
            
            dateDiv.appendChild(labelEl);
            dateDiv.appendChild(valueEl);
            keyDatesList.appendChild(dateDiv);
        });
        keyDatesSection.appendChild(keyDatesList);
        resultsContainer.appendChild(keyDatesSection);

        const domainInfoData = {
            "Domain Name": data.name,
            "IDN Name": data.idnName,
            "Registered": data.registered ? "Yes" : "No",
            "Name Servers": data.nameserver, 
            "IP Addresses": data.ips, 
            "DNSSEC": data.dnssec,
            "Source": data.source,
            "Queried WHOIS Server": data.whoisserver,
        };

        const domainSection = createSection("Domain Overview", domainInfoData);
        if (domainSection) {
            if (data.status && Array.isArray(data.status) && data.status.length > 0) {
                const statusDt = document.createElement('dt');
                statusDt.textContent = "Status";
                const statusDd = document.createElement('dd');
                statusDd.className = 'status-badges-container';
                data.status.forEach(s => {
                    statusDd.appendChild(createStatusBadge(s));
                });
                const statusItemDiv = document.createElement('div');
                statusItemDiv.className = 'result-item';
                statusItemDiv.appendChild(statusDt);
                statusItemDiv.appendChild(statusDd);
                
                const dlElement = domainSection.querySelector('dl');
                if (dlElement) {
                    dlElement.appendChild(statusItemDiv);
                } else { 
                     domainSection.appendChild(statusItemDiv);
                }
            }
            resultsContainer.appendChild(domainSection);
        }
        
        if (data.registrar) {
            let registrarUrlDisplay = 'N/A';
            if (data.registrar.url) {
                let url = data.registrar.url;
                if (!url.startsWith('http://') && !url.startsWith('https://')) {
                    url = 'https://' + url;
                }
                registrarUrlDisplay = `<a href="${url}" target="_blank" rel="noopener noreferrer">${data.registrar.url}</a>`;
            }

            const registrarInfo = {
                "Name": data.registrar.name,
                "IANA ID": data.registrar.id, 
                "Email": data.registrar.email,
                "URL": registrarUrlDisplay,
                "Phone": data.registrar.phone
            };
            const registrarSection = createSection("Registrar Details", registrarInfo, true); 
            if (registrarSection) resultsContainer.appendChild(registrarSection);
        }

        if (data.contacts) { 
            if (data.contacts.owner && data.contacts.owner.length > 0) {
                const ownerSection = createSection("Owner Contact(s)", data.contacts.owner, true); 
                if (ownerSection) resultsContainer.appendChild(ownerSection);
            }
            if (data.contacts.admin && data.contacts.admin.length > 0) {
                const adminSection = createSection("Administrative Contact(s)", data.contacts.admin, true); 
                if (adminSection) resultsContainer.appendChild(adminSection);
            }
            if (data.contacts.tech && data.contacts.tech.length > 0) {
                const techSection = createSection("Technical Contact(s)", data.contacts.tech, true); 
                if (techSection) resultsContainer.appendChild(techSection);
            }
        }
        
        if (resultsContainer.children.length === 0) { 
             displayError(`WHOIS data for "${data.name || domainInput.value}" was retrieved but contained no displayable fields with the current mapping.`, false, true);
        }
        resultsContainer.classList.add('visible');
    }
    
    const keyFormatOverrides = {
        "id": "ID",
        "ianaid": "IANA ID",
        "dnssec": "DNSSEC",
        "idnname": "IDN Name",
        "ipaddresses": "IP Addresses",
        "nameservers": "Name Servers",
        "creationdate": "Creation Date",
        "updateddate": "Updated Date",
        "expirationdate": "Expiration Date",
        "nameserver": "Name Server" 
    };

    function formatKey(key) {
        const normalizedKey = key.toLowerCase().replace(/[_\s-]/g, ''); 
        if (keyFormatOverrides[normalizedKey]) {
            return keyFormatOverrides[normalizedKey];
        }
        return key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    }

    function createSection(title, objOrArray, allowHTML = false) {
        if (!objOrArray || (Array.isArray(objOrArray) && objOrArray.length === 0) || (typeof objOrArray === 'object' && !Array.isArray(objOrArray) && Object.keys(objOrArray).length === 0)) {
            return null;
        }
    
        const sectionDiv = document.createElement('div');
        sectionDiv.className = 'result-section';
    
        const titleEl = document.createElement('h3');
        titleEl.textContent = title;
        sectionDiv.appendChild(titleEl);
    
        const dl = document.createElement('dl');
        const itemsToProcess = Array.isArray(objOrArray) ? objOrArray : [objOrArray];
    
        itemsToProcess.forEach((item, index) => {
            if (itemsToProcess.length > 1 && typeof item === 'object' && Object.keys(item).length > 0 && (title.toLowerCase().includes("contact") || title.toLowerCase().includes("owner") || title.toLowerCase().includes("admin") || title.toLowerCase().includes("tech"))) {
                const subHeader = document.createElement('p');
                subHeader.className = 'contact-entry-header'; 
                let subTitleText = `${title.replace(/\(s\)$/, '').replace(' Contacts', '').replace(' Contact','')} Entry #${index + 1}`;
                if(item.type) subTitleText = formatKey(item.type);
                else if (item.name && typeof item.name === 'string' && item.name.trim() !== '') subTitleText = item.name;
                else if (item.organization && typeof item.organization === 'string' && item.organization.trim() !== '') subTitleText = item.organization;
                subHeader.textContent = subTitleText;
                dl.appendChild(subHeader);
            }

            for (const key in item) {
                if (Object.hasOwnProperty.call(item, key) && item[key] !== null && item[key] !== undefined && String(item[key]).trim() !== '') {
                    const dt = document.createElement('dt');
                    dt.textContent = formatKey(key);
                    
                    const dd = document.createElement('dd');
                    if (allowHTML && (key.toLowerCase() === 'url' || (key.toLowerCase() === 'email' && typeof item[key] === 'string' && item[key].includes('@')))) { 
                         if (key.toLowerCase() === 'email') {
                            dd.innerHTML = `<a href="mailto:${item[key]}">${item[key]}</a>`;
                         } else { 
                            dd.innerHTML = item[key]; 
                         }
                    } else if (Array.isArray(item[key])) {
                        if (item[key].length > 0) {
                            const ul = document.createElement('ul');
                            item[key].forEach(subItem => {
                                const li = document.createElement('li');
                                li.textContent = subItem;
                                ul.appendChild(li);
                            });
                            dd.appendChild(ul);
                        } else {
                            dd.textContent = "N/A"; 
                        }
                    } else if (typeof item[key] === 'object') {
                        const nestedDl = document.createElement('dl');
                        nestedDl.style.paddingLeft = '10px';
                        let hasNestedContent = false;
                        for(const nestedKey in item[key]){
                            if (Object.hasOwnProperty.call(item[key], nestedKey) && item[key][nestedKey] !== null && String(item[key][nestedKey]).trim() !== '') {
                                const nestedDt = document.createElement('dt');
                                nestedDt.textContent = formatKey(nestedKey);
                                nestedDt.style.opacity = '0.8';
                                const nestedDd = document.createElement('dd');
                                nestedDd.textContent = item[key][nestedKey];
                                nestedDl.appendChild(nestedDt);
                                nestedDl.appendChild(nestedDd);
                                hasNestedContent = true;
                            }
                        }
                        if(hasNestedContent) dd.appendChild(nestedDl);
                        else dd.textContent = "N/A"; 
                    } else {
                        dd.textContent = item[key];
                    }
                    
                    const itemDiv = document.createElement('div');
                    itemDiv.className = 'result-item';
                    itemDiv.appendChild(dt);
                    itemDiv.appendChild(dd);
                    dl.appendChild(itemDiv);
                }
            }
        });
    
        if (dl.children.length > 0) {
            sectionDiv.appendChild(dl);
            return sectionDiv;
        }
        return null;
    }

    function showLoading(isLoading) {
        loadingIndicator.style.display = isLoading ? 'block' : 'none';
        if (searchButton && (!apiKey || apiKey === 'YOUR_WHOISJSON_API_KEY_HERE' || apiKey === '')) {
            searchButton.disabled = true;
        } else if (searchButton) {
            searchButton.disabled = isLoading;
        }
    }

    function displayError(message, isCritical = false, isInfo = false) {
        errorContainer.className = isInfo ? 'info-message' : 'error-message'; 
        if(isCritical && !isInfo) errorContainer.classList.add('critical'); 

        errorContainer.textContent = message;
        errorContainer.classList.add('visible');
        
        if (isCritical) { 
             if (searchButton) searchButton.disabled = true;
             if (domainInput) domainInput.disabled = true;
        }
        clearResults(); 
    }

    function clearResults() {
        resultsContainer.innerHTML = ''; 
        resultsContainer.classList.remove('visible');
    }

    function clearError() {
        errorContainer.textContent = '';
        errorContainer.classList.remove('visible');
        errorContainer.classList.remove('critical'); 
    }

    if (whoisForm) {
        whoisForm.addEventListener('submit', (e) => {
            e.preventDefault();
            // Check apiKey from config.js
            if (apiKey && apiKey !== 'YOUR_WHOISJSON_API_KEY_HERE' && apiKey !== '') {
                if (searchButton.disabled && !loadingIndicator.style.display.includes('block')) searchButton.disabled = false; 
                if (domainInput.disabled) domainInput.disabled = false;
            } else { 
                 if (searchButton) searchButton.disabled = true;
                 if (domainInput) domainInput.disabled = true;
                 displayError("API Key not configured in config.js. Please update the CONFIG_API_KEY constant.", true);
                 return;
            }

            if (searchButton.disabled) return; 

            const domain = domainInput.value.trim().toLowerCase();
            if (domain) {
                if (window.location.protocol !== "file:") {
                    try {
                        history.pushState(null, '', `/${domain}`);
                    } catch (histError) { /* ignore */ }
                }
                fetchWhoisData(domain);
            } else {
                displayError("Please enter a domain name.");
            }
        });
    } else {
        console.error("whoisForm element not found!"); 
    }

    function handlePathQuery() {
        const path = window.location.pathname;
        const hasApiKey = apiKey && apiKey !== 'YOUR_WHOISJSON_API_KEY_HERE' && apiKey !== ''; // Use apiKey from config

        if (!hasApiKey) {
            resultsContainer.classList.remove('visible'); 
            if (path && path !== '/' && path.length > 1) {
                const potentialDomain = decodeURIComponent(path.substring(1));
                if (isPotentialDomainForPath(potentialDomain)) { 
                    domainInput.value = potentialDomain;
                }
            }
            return; 
        }

        clearError(); 

        if (path && path !== '/' && path.length > 1) {
            const domainFromPath = decodeURIComponent(path.substring(1)); 
            if (isPotentialDomainForPath(domainFromPath)) {
                domainInput.value = domainFromPath; 
                fetchWhoisData(domainFromPath);
            } else { 
                resultsContainer.innerHTML = '<p class="initial-message">Enter a domain name above to see WHOIS data.</p>';
                resultsContainer.classList.add('visible');
            }
        } else { 
             resultsContainer.innerHTML = '<p class="initial-message">Enter a domain name above to see WHOIS data.</p>';
             resultsContainer.classList.add('visible');
        }
    }

    window.addEventListener('popstate', () => {
        clearError();
        clearResults(); 
        handlePathQuery(); 
    });
    
    if (apiKey && apiKey !== 'YOUR_WHOISJSON_API_KEY_HERE' && apiKey !== '') { // Check apiKey from config
        handlePathQuery(); 
    } else {
        resultsContainer.classList.remove('visible');
    }
});