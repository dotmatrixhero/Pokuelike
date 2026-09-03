// Implementation for Resource Container

template <typename Resource, typename Identifier>
void ResourceContainer<Resource, Identifier>::load(Identifier id, const std::string& filename)
{
    std::unique_ptr<Resource> resource(new Resource(filename));
    insertResource(id, std::move(resource));
}

template <typename Resource, typename Identifier>
template <typename Param>
void ResourceContainer<Resource, Identifier>::load(Identifier id, const std::string& filename, const Param& param)
{
    std::unique_ptr<Resource> resource(new Resource(filename, param));
    insertResource(id, std::move(resource));
}


template <typename Resource, typename Identifier>
Resource& ResourceContainer<Resource, Identifier>::get(Identifier id)
{
    auto index = resourceMap.find(id);
    assert(index != resourceMap.end());

    return *index->second;
}

template <typename Resource, typename Identifier>
const Resource& ResourceContainer<Resource, Identifier>::get(Identifier id) const
{
    auto index = resourceMap.find(id);
    assert(index != resourceMap.end());

    return *index->second;
}

// template <typename Resource, typename Identifier>
// const Resource& ResourceContainer<Resource, Identifier>::operator[](Identifier id) const
// {
//     return this->get(id);
// }

// template <typename Resource, typename Identifier>
// Resource& ResourceContainer<Resource, Identifier>::operator[](Identifier id)
// {
//     return this->get(id);
// }

template <typename Resource, typename Identifier>
void ResourceContainer<Resource, Identifier>::insertResource(Identifier id, std::unique_ptr<Resource> resource) 
{
    auto pair = resourceMap.insert(std::make_pair(id, std::move(resource)));

    // Make sure we actually inserted something.
    assert(pair.second);
}
