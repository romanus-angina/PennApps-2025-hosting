import { useState, useRef } from 'react';

interface AddressSearchProps {
    onRouteSearch: (coord1: { lat: number; lng: number }, coord2: { lat: number; lng: number }) => Promise<void>;
    disabled?: boolean;
}

interface Suggestion {
    display_name: string;
    lat: string;
    lon: string;
}

interface AutocompleteState {
    suggestions1: Suggestion[];
    suggestions2: Suggestion[];
    showSuggestions1: boolean;
    showSuggestions2: boolean;
    loading1: boolean;
    loading2: boolean;
}

export default function AddressSearch({ onRouteSearch, disabled = false }: AddressSearchProps) {
    const [addressSearch, setAddressSearch] = useState({
        address1: '',
        address2: '',
        searching: false
    });

    const [autocomplete, setAutocomplete] = useState<AutocompleteState>({
        suggestions1: [],
        suggestions2: [],
        showSuggestions1: false,
        showSuggestions2: false,
        loading1: false,
        loading2: false
    });

    const searchTimeoutRef = useRef<{ timeout1?: number; timeout2?: number }>({});

    // Function to geocode an address using OpenStreetMap Nominatim API
    const geocodeAddress = async (address: string): Promise<{ lat: number; lng: number } | null> => {
        try {
            const response = await fetch(
                `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`
            );
            const data = await response.json();

            if (data && data.length > 0) {
                return {
                    lat: parseFloat(data[0].lat),
                    lng: parseFloat(data[0].lon)
                };
            }
            return null;
        } catch (error) {
            console.error('Geocoding error:', error);
            return null;
        }
    };

    const searchSuggestions = async (query: string, field: 'address1' | 'address2') => {
        if (query.length < 3) {
            setAutocomplete(prev => ({
                ...prev,
                [`suggestions${field === 'address1' ? '1' : '2'}`]: [],
                [`showSuggestions${field === 'address1' ? '1' : '2'}`]: false,
                [`loading${field === 'address1' ? '1' : '2'}`]: false
            }));
            return;
        }

        const fieldNum = field === 'address1' ? '1' : '2';
        setAutocomplete(prev => ({
            ...prev,
            [`loading${fieldNum}`]: true
        }));

        try {
            const response = await fetch(
                `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&addressdetails=1`
            );
            const data = await response.json();

            setAutocomplete(prev => ({
                ...prev,
                [`suggestions${fieldNum}`]: data || [],
                [`showSuggestions${fieldNum}`]: true,
                [`loading${fieldNum}`]: false
            }));
        } catch (error) {
            console.error('Autocomplete search error:', error);
            setAutocomplete(prev => ({
                ...prev,
                [`suggestions${fieldNum}`]: [],
                [`showSuggestions${fieldNum}`]: false,
                [`loading${fieldNum}`]: false
            }));
        }
    };

    const handleAddressChange = (value: string, field: 'address1' | 'address2') => {
        setAddressSearch(prev => ({ ...prev, [field]: value }));

        // Clear existing timeout
        const timeoutKey = field === 'address1' ? 'timeout1' : 'timeout2';
        if (searchTimeoutRef.current[timeoutKey]) {
            clearTimeout(searchTimeoutRef.current[timeoutKey]);
        }

        // Set new timeout for debounced search
        searchTimeoutRef.current[timeoutKey] = window.setTimeout(() => {
            searchSuggestions(value, field);
        }, 300);
    };

    const selectSuggestion = (suggestion: Suggestion, field: 'address1' | 'address2') => {
        setAddressSearch(prev => ({ ...prev, [field]: suggestion.display_name }));
        const fieldNum = field === 'address1' ? '1' : '2';
        setAutocomplete(prev => ({
            ...prev,
            [`showSuggestions${fieldNum}`]: false
        }));
    };

    const handleRouteSearch = async () => {
        if (!addressSearch.address1.trim() || !addressSearch.address2.trim()) {
            alert('Please enter both addresses');
            return;
        }

        setAddressSearch(prev => ({ ...prev, searching: true }));

        try {
            // Geocode both addresses
            const [coord1, coord2] = await Promise.all([
                geocodeAddress(addressSearch.address1),
                geocodeAddress(addressSearch.address2)
            ]);

            if (!coord1 || !coord2) {
                alert('Could not find one or both addresses. Please try different addresses.');
                return;
            }

            await onRouteSearch(coord1, coord2);
        } catch (error) {
            console.error('Route search error:', error);
            alert('Failed to find route. Please try again.');
        } finally {
            setAddressSearch(prev => ({ ...prev, searching: false }));
        }
    };

    return (
        <div style={{ marginBottom: '12px', borderBottom: '1px solid #ddd', paddingBottom: '12px' }}>
            <div style={{ fontWeight: 'bold', marginBottom: '8px', fontSize: '13px' }}>
                Search by Address
            </div>

            {/* From Address with Autocomplete */}
            <div style={{ position: 'relative', marginBottom: '6px' }}>
                <input
                    type="text"
                    placeholder="From address..."
                    value={addressSearch.address1}
                    onChange={(e) => handleAddressChange(e.target.value, 'address1')}
                    onFocus={() => addressSearch.address1.length >= 3 && setAutocomplete(prev => ({ ...prev, showSuggestions1: true }))}
                    onBlur={() => setTimeout(() => setAutocomplete(prev => ({ ...prev, showSuggestions1: false })), 200)}
                    disabled={disabled}
                    style={{
                        width: '100%',
                        padding: '6px',
                        border: '1px solid #ccc',
                        borderRadius: '4px',
                        fontSize: '12px',
                        boxSizing: 'border-box',
                        opacity: disabled ? 0.6 : 1
                    }}
                />
                {autocomplete.loading1 && (
                    <div style={{ position: 'absolute', right: '8px', top: '6px', fontSize: '10px', color: '#666' }}>
                        Searching...
                    </div>
                )}
                {autocomplete.showSuggestions1 && autocomplete.suggestions1.length > 0 && (
                    <div style={{
                        position: 'absolute',
                        top: '100%',
                        left: 0,
                        right: 0,
                        background: 'white',
                        border: '1px solid #ccc',
                        borderTop: 'none',
                        borderRadius: '0 0 4px 4px',
                        maxHeight: '150px',
                        overflowY: 'auto',
                        zIndex: 1001,
                        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                    }}>
                        {autocomplete.suggestions1.map((suggestion, index) => (
                            <div
                                key={index}
                                onMouseDown={() => selectSuggestion(suggestion, 'address1')}
                                style={{
                                    padding: '8px',
                                    cursor: 'pointer',
                                    borderBottom: index < autocomplete.suggestions1.length - 1 ? '1px solid #eee' : 'none',
                                    fontSize: '11px',
                                    lineHeight: '1.3'
                                }}
                                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f5f5f5')}
                                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'white')}
                            >
                                {suggestion.display_name}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* To Address with Autocomplete */}
            <div style={{ position: 'relative', marginBottom: '8px' }}>
                <input
                    type="text"
                    placeholder="To address..."
                    value={addressSearch.address2}
                    onChange={(e) => handleAddressChange(e.target.value, 'address2')}
                    onFocus={() => addressSearch.address2.length >= 3 && setAutocomplete(prev => ({ ...prev, showSuggestions2: true }))}
                    onBlur={() => setTimeout(() => setAutocomplete(prev => ({ ...prev, showSuggestions2: false })), 200)}
                    disabled={disabled}
                    style={{
                        width: '100%',
                        padding: '6px',
                        border: '1px solid #ccc',
                        borderRadius: '4px',
                        fontSize: '12px',
                        boxSizing: 'border-box',
                        opacity: disabled ? 0.6 : 1
                    }}
                />
                {autocomplete.loading2 && (
                    <div style={{ position: 'absolute', right: '8px', top: '6px', fontSize: '10px', color: '#666' }}>
                        Searching...
                    </div>
                )}
                {autocomplete.showSuggestions2 && autocomplete.suggestions2.length > 0 && (
                    <div style={{
                        position: 'absolute',
                        top: '100%',
                        left: 0,
                        right: 0,
                        background: 'white',
                        border: '1px solid #ccc',
                        borderTop: 'none',
                        borderRadius: '0 0 4px 4px',
                        maxHeight: '150px',
                        overflowY: 'auto',
                        zIndex: 1001,
                        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                    }}>
                        {autocomplete.suggestions2.map((suggestion, index) => (
                            <div
                                key={index}
                                onMouseDown={() => selectSuggestion(suggestion, 'address2')}
                                style={{
                                    padding: '8px',
                                    cursor: 'pointer',
                                    borderBottom: index < autocomplete.suggestions2.length - 1 ? '1px solid #eee' : 'none',
                                    fontSize: '11px',
                                    lineHeight: '1.3'
                                }}
                                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f5f5f5')}
                                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'white')}
                            >
                                {suggestion.display_name}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <button
                onClick={handleRouteSearch}
                disabled={disabled || addressSearch.searching || !addressSearch.address1.trim() || !addressSearch.address2.trim()}
                style={{
                    width: '100%',
                    padding: '6px 12px',
                    fontSize: '12px',
                    backgroundColor: (disabled || addressSearch.searching || !addressSearch.address1.trim() || !addressSearch.address2.trim()) ? '#ccc' : '#28a745',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: (disabled || addressSearch.searching || !addressSearch.address1.trim() || !addressSearch.address2.trim()) ? 'not-allowed' : 'pointer'
                }}
            >
                {addressSearch.searching ? 'Searching...' : 'Find Route'}
            </button>
        </div>
    );
}