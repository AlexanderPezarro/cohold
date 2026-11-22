import React, { useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { TextField } from '../../primitives/TextField';
import { Select } from '../../primitives/Select';
import { Button } from '../../primitives/Button';
import {
  addressLookupService,
  type AddressSuggestion,
} from '../../../services/api/addressLookup.service';
import { StepForm } from './StepForm';
import { propertiesService } from '../../../services/api/properties.service';
import { useProperties } from '../../../contexts/PropertiesContext';
import { useToast } from '../../../contexts/ToastContext';
import { ApiError } from '../../../types/api.types';
import type { CreatePropertyRequest } from '../../../types/api.types';
import type { OnboardingStepFormProps } from './types';
import styles from './Onboarding.module.scss';

const PROPERTY_TYPES: CreatePropertyRequest['propertyType'][] = [
  'House',
  'Flat',
  'Studio',
  'Bungalow',
  'Terraced',
  'Semi-Detached',
  'Detached',
  'Maisonette',
  'Commercial',
];

const TYPE_OPTIONS = PROPERTY_TYPES.map((type) => ({
  value: type,
  label: type,
}));

const EMPTY = {
  name: '',
  street: '',
  city: '',
  county: '',
  postcode: '',
  propertyType: 'House' as CreatePropertyRequest['propertyType'],
};

/**
 * Asks only for what a property can't exist without. Purchase price, notes and
 * listing state are all editable later on the property page - during setup they
 * are just friction.
 *
 * The postcode comes first: looking it up fills town and county, and, when the
 * server has an address provider, offers the addresses there to pick from.
 */
export const PropertyStepForm: React.FC<OnboardingStepFormProps> = ({ onCompleted }) => {
  const toast = useToast();
  const { refetch } = useProperties();
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [chosen, setChosen] = useState('');
  const streetRef = useRef<HTMLInputElement>(null);

  const setField = (field: keyof typeof EMPTY, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: '' }));
  };

  const findAddress = async () => {
    if (!form.postcode.trim()) {
      setErrors((current) => ({
        ...current,
        postcode: 'Enter a postcode to look up',
      }));
      return;
    }
    try {
      setLookingUp(true);
      setSuggestions([]);
      setChosen('');
      const result = await addressLookupService.lookup(form.postcode);
      setForm((current) => ({
        ...current,
        postcode: result.postcode,
        city: result.city || current.city,
        county: result.county || current.county,
      }));
      setErrors((current) => ({
        ...current,
        postcode: '',
        city: '',
        county: '',
      }));
      setSuggestions(result.addresses);
      // Without a list to pick from, the street is the only thing left to type.
      if (result.addresses.length === 0) streetRef.current?.focus();
    } catch (err) {
      setErrors((current) => ({
        ...current,
        postcode:
          err instanceof ApiError ? err.message : 'Lookup failed — enter the address by hand',
      }));
    } finally {
      setLookingUp(false);
    }
  };

  const chooseAddress = (label: string) => {
    setChosen(label);
    const address = suggestions.find((option) => option.label === label);
    if (!address) return;
    setForm((current) => ({
      ...current,
      street: address.street,
      city: address.city,
      // A property is usually known by its first line, so suggest that as the name.
      name: current.name || address.street.split(',')[0],
    }));
    setErrors((current) => ({ ...current, street: '', city: '', name: '' }));
  };

  const validate = () => {
    const found: Record<string, string> = {};
    if (!form.name.trim()) found.name = 'Give the property a name you will recognise';
    if (!form.street.trim()) found.street = 'Street is required';
    if (!form.city.trim()) found.city = 'City is required';
    if (!form.county.trim()) found.county = 'County is required';
    if (!form.postcode.trim()) found.postcode = 'Postcode is required';
    setErrors(found);
    return Object.keys(found).length === 0;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!validate()) return;

    try {
      setSubmitting(true);
      const property = await propertiesService.createProperty({
        name: form.name.trim(),
        street: form.street.trim(),
        city: form.city.trim(),
        county: form.county.trim(),
        postcode: form.postcode.trim(),
        propertyType: form.propertyType,
      });
      // Keep the shared property list in step - the lease step reads from it.
      await refetch();
      toast.success(`${property.name} added`);
      setForm(EMPTY);
      setSuggestions([]);
      setChosen('');
      await onCompleted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add the property');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <StepForm
      onSubmit={handleSubmit}
      error={error}
      submitting={submitting}
      submitLabel="Add property"
    >
      <div className={`${styles.fullWidth} ${styles.postcodeRow}`}>
        <TextField
          label="Postcode"
          value={form.postcode}
          onChange={(e) => setField('postcode', e.target.value)}
          onKeyDown={(e) => {
            // Enter looks the postcode up rather than submitting a half-filled form.
            if (e.key === 'Enter') {
              e.preventDefault();
              findAddress();
            }
          }}
          error={!!errors.postcode}
          helperText={errors.postcode}
          autoComplete="postal-code"
          fullWidth
        />
        <Button
          type="button"
          variant="secondary"
          startIcon={<Search size={16} />}
          loading={lookingUp}
          onClick={findAddress}
        >
          Find address
        </Button>
      </div>
      {suggestions.length > 0 && (
        <div className={styles.fullWidth}>
          <Select
            label="Address"
            placeholder={`Choose from ${suggestions.length} addresses`}
            options={suggestions.map((option) => ({
              value: option.label,
              label: option.label,
            }))}
            value={chosen}
            onChange={chooseAddress}
            fullWidth
          />
        </div>
      )}
      <div className={styles.fullWidth}>
        <TextField
          ref={streetRef}
          label="Street"
          value={form.street}
          onChange={(e) => setField('street', e.target.value)}
          error={!!errors.street}
          helperText={errors.street}
          fullWidth
        />
      </div>
      <TextField
        label="City"
        value={form.city}
        onChange={(e) => setField('city', e.target.value)}
        error={!!errors.city}
        helperText={errors.city}
        fullWidth
      />
      <TextField
        label="County"
        value={form.county}
        onChange={(e) => setField('county', e.target.value)}
        error={!!errors.county}
        helperText={errors.county}
        fullWidth
      />
      <TextField
        label="Property name"
        value={form.name}
        onChange={(e) => setField('name', e.target.value)}
        error={!!errors.name}
        helperText={errors.name}
        placeholder="e.g. 42 Oak Avenue"
        fullWidth
      />
      <Select
        label="Property type"
        options={TYPE_OPTIONS}
        value={form.propertyType}
        onChange={(value) => setField('propertyType', value)}
        fullWidth
      />
    </StepForm>
  );
};
