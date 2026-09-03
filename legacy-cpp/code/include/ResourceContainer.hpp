#ifndef _ResourceContainer_hpp_
#define _ResourceContainer_hpp_

#include <map>
#include <string>
#include <memory>

#include <cassert>

// Templated class for resource management.
// Possible Usage:
//
//     enum class ImageID { Background1, Background2, Background3 };
//     typedef ResourceContainer<Image, ImageID> ImageHolder;
//
//     ImageHolder imageManager;
//     imageManager.load(ImageID::Background2, "../data/Hello.png");
//     Image i = imageManager.get(ImageID::Background2);
//
// The "Image" class would need a constructor that takes in a filename.
// std::string can possibly be used instead of a strongly-typed enum.

template <typename Resource, typename Identifier>
class ResourceContainer
{
    public:
    void load(Identifier id, const std::string& filename);

    template <typename Param>
    void load(Identifier id, const std::string& filename, const Param& param);

    Resource& get(Identifier id);
    const Resource& get(Identifier id) const;

    // Resource& operator[](Identifier id);
    // const Resource& operator[](Identifier id) const;

    protected:
    void insertResource(Identifier id, std::unique_ptr<Resource> resource);

    protected:
    std::map<Identifier, std::unique_ptr<Resource>> resourceMap;
};

#include "ResourceContainer.inl"

#endif // _ResourceContainer_hpp_
